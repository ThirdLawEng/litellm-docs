---
slug: anthropic-streaming-perf
title: "2.85× More Throughput on the Anthropic /v1/messages Streaming Path"
date: 2026-05-25T09:00:00
authors:
  - yassin
description: "How we cut per-request and per-chunk overhead on LiteLLM's Anthropic /v1/messages streaming path — 2.66× faster time-to-first-token and 2.85× more throughput, with byte-identical wire output."
tags: [performance, streaming, anthropic, ai-gateway]
hide_table_of_contents: true
---

*Last Updated: May 2026*

The Anthropic `/v1/messages` streaming endpoint is one of the hottest paths in the LiteLLM proxy. A single response streams anywhere from dozens to thousands of Server-Sent Events (SSE), and the proxy touches **every one of them** — decoding the chunk, running hooks, tracking cost, and re-encoding it for the client. Whatever the proxy does per request and per chunk sets the ceiling on two numbers users feel directly: how fast the first token arrives (TTFT), and how many concurrent streams a single instance can serve.

It turns out a lot of that work is a **no-op in the default configuration**. We were running per-chunk tracing spans with tracing off, awaiting streaming hooks with no callbacks registered, buffering and rebuilding entire responses to call hooks that all returned "do nothing," and serializing the same request body twice. This post is about the per-request and per-chunk overhead we removed — and the parity tests that kept the bytes on the wire byte-identical while doing it.

{/* truncate */}

![Before vs after: per-request and per-chunk work removed from the Anthropic /v1/messages streaming hot path in the default config](/img/blog/anthropic_streaming_perf/streaming_hotpath_before_after.svg)

## The results

Measured against a local mock Anthropic SSE provider on the same host: 500 requests per run, concurrency 20, an 80-request warmup, median of 5 back-to-back runs. Baseline is the path with these changes reverted; Optimized is the path with them in.

| Metric | Baseline | Optimized | Δ |
|---|---:|---:|---:|
| TTFT p50 (ms) | 241.88 | 90.89 | **−62.4%** (2.66× faster) |
| TTFT p95 (ms) | 463.86 | 148.23 | **−68.0%** (3.13× faster) |
| TTFT p99 (ms) | 1313.46 | 155.77 | **−88.1%** (8.43× faster) |
| Full-request p50 (ms) | 242.26 | 91.32 | **−62.3%** |
| Full-request p95 (ms) | 464.24 | 148.88 | **−67.9%** |
| Output tokens / s | 4,394.5 | 12,504.4 | **+184.6%** (2.85×) |
| Requests / s | 68.66 | 195.38 | **+184.6%** (2.85×) |

The tail moved the most. p99 TTFT dropped from over a second to ~156ms because the work we removed was exactly the work that piled up under concurrency and stretched the slowest requests.

![Time-to-first-token at p50, p95, and p99 — baseline vs optimized (lower is better)](/img/blog/anthropic_streaming_perf/ttft_latency.svg)

![Throughput — requests per second and output tokens per second, baseline vs optimized](/img/blog/anthropic_streaming_perf/throughput.svg)

## Skipping work that's a no-op in the default config

The biggest wins came from simply *not doing* work that produced no observable effect:

- **Per-chunk Datadog span.** We were opening and closing a tracing span for every chunk even when tracing was disabled. It now runs only when tracing is actually on.
- **Per-chunk streaming hook.** The async streaming hook was awaited on every chunk even when no callback, guardrail, or cost-injection was active. With nothing registered, there's nothing to await.
- **Agentic post-processing wrapper.** This wrapper buffers every chunk, rebuilds the full response from the SSE stream, and calls post-processing hooks. When no callback overrides that hook, every one of those hooks returns `(False, {})` — i.e., "do nothing." We now skip the entire wrapper unless a callback actually overrides the hook.

![Per-chunk pipeline: the Datadog span, streaming hook, and agentic wrapper are skipped when nothing is registered to consume them](/img/blog/anthropic_streaming_perf/per_chunk_pipeline.svg)

## Not doing the same work twice per request

A few things were being computed twice per request for no reason:

- **Request body serialization.** The body was serialized once for the pre-call log and again for the upstream wire. We now serialize it once and reuse it.
- **Optional-params type-hint resolution.** Resolving the optional-params type hints costs ~80µs per request and the answer never changes, so we memoize it.
- **`strip_empty_text_blocks`.** When the async wrapper has already sanitized the request, we skip the redundant second scan.

## Cheaper end-of-stream reconstruction

At the end of a stream, the proxy reconstructs a single response object (for logging and billing) from all the chunks it saw. The legacy path constructs one `ModelResponseStream` Pydantic model **per output token** before handing them to `stream_chunk_builder` — an O(number of output tokens) pile of object allocations.

For the common case — a long homogeneous run of `content_block_delta` text events — we collapse that run into a single equivalent SSE event *before* `stream_chunk_builder` runs, removing the per-token Pydantic constructions. Streams that contain tool-use, thinking, or citation blocks fall back to the unchanged legacy path, so nothing about their output changes.

![End-of-stream reconstruction: a homogeneous run of content_block_delta text events is collapsed into one equivalent SSE event before stream_chunk_builder, instead of one Pydantic model per token](/img/blog/anthropic_streaming_perf/stream_reconstruction.svg)

## Cheaper logging on the hot path

Logging is easy to under-estimate on a hot path:

- **Gated debug f-strings.** Debug log lines that serialize full message payloads now evaluate their `f-string` only behind `isEnabledFor(DEBUG)`. At non-debug levels we no longer pay to serialize payloads we immediately throw away.
- **Hoisted `cost_injection_active`.** This flag doesn't change mid-stream, so we compute it once instead of inside the per-chunk loop.
- **One fewer async-generator layer.** We dropped an async-generator layer per chunk in `async_sse_data_generator`.

## Parity, guaranteed

None of this is worth anything if it changes what the client receives or what we bill. Every fast path **falls back to the legacy path** for anything it doesn't recognize. On top of that:

- New parity tests assert **byte-identical logged and billed payloads** between the fast path and the legacy path.
- Unit tests cover agentic-hook detection, pre-serialized body reuse, and the memoized key resolution.

The wire output is the same. The difference is everything we *stopped* doing to produce it.

## Reproducing the benchmark

The benchmark ships in the repo. It boots a local mock Anthropic SSE provider plus the proxy under test, so it's an apples-to-apples comparison across commits on the same machine:

```bash
uv run python scripts/benchmark_anthropic_messages_perf.py \
    --label optimized --proxy-port 4099 --provider-port 8098 \
    --requests 500 --concurrency 20 --warmup 80 --repeats 5
```

## Key takeaways

- On a streaming hot path, the cheapest work is the work you **don't do**. Most of the win here was skipping per-chunk operations that were no-ops in the default config.
- **Do per-request work once.** Serializing the body twice and re-resolving type hints every request adds up at high RPS.
- **Reconstruction at end-of-stream is O(tokens).** Collapsing a homogeneous text run before `stream_chunk_builder` removes a per-token allocation cost.
- **Parity first.** Every fast path falls back to the legacy path, and parity tests assert byte-identical logged/billed output, so the speedup is free of behavior changes.

## Conclusion

Performance work on a proxy is often less about clever new code and more about deleting work the system was doing for no reason. By skipping no-op hooks, reusing per-request work, and reconstructing the end-of-stream response more cheaply, we cut TTFT by ~62% at the median and nearly **9× at p99**, and pushed single-instance throughput up **2.85×** — all while keeping the bytes on the wire exactly the same.
