---
title: Claude Code Compatibility
sidebar_label: Claude Code Compatibility
---

import ClaudeCodeCompatibilityTable from '@site/src/components/ClaudeCodeCompatibilityTable';

# Claude Code × LiteLLM compatibility matrix

This table is regenerated daily by an automated populator that runs the
[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) against
the latest stable LiteLLM proxy across each supported provider, with
Haiku 4.5, Sonnet 4.6, and Opus 4.7 in parallel. A cell goes green only
if all three model tiers pass.

<ClaudeCodeCompatibilityTable />

## Legend

| Glyph | Meaning |
| --- | --- |
| ✅ | All three model tiers pass for this `(feature, provider)` cell. |
| ❌ | At least one model tier failed. Hover for the upstream error. |
| — | No test ran for this combination. |
| n/a | Not applicable (e.g. provider doesn't expose this feature). Hover for the reason. |

## Known issues

Red cells with a known root cause and a tracked fix are listed below. Each
entry stays here until the named fix has landed in a `v*-stable` release;
the next daily run after that tag is cut will flip the cells green and
the entry will be removed.

### Opus 4.7 thinking on Bedrock Invoke + Vertex AI

- **Affected cells**: `thinking × bedrock_invoke`, `thinking × vertex_ai`. Anthropic-native and Azure Foundry are unaffected on the same tier.
- **Symptom**: Claude Code's `--effort max` flag is sent to the proxy as `output_config.effort=max`. The Bedrock Invoke and Vertex AI request transformers in `v1.83.14-stable` strip `output_config.effort` for Claude 4.6+ models that aren't on a small hardcoded allow-list, so the upstream request goes out without thinking enabled. The response has no `thinking` content block and the cell is marked failed.
- **Status**: Fixed on `main` by [commit `a6c673e7b9`](https://github.com/BerriAI/litellm/commit/a6c673e7b9) (`fix(anthropic,bedrock,vertex): forward output_config.effort + 400 on garbage reasoning_effort`). Waiting on the next `v*-stable` cut.

### Bedrock Converse — Haiku 4.5 content-block validation

- **Affected cells**: every `* × bedrock_converse` cell (the entire Converse column).
- **Symptom**: Claude Haiku 4.5 routed through AWS Bedrock's Converse API returns `Content block is not a text block` on the first assistant message of every conversation. Because the matrix only marks a cell green when all three model tiers pass, this Haiku-only failure paints the whole Converse column red even for features that work on Sonnet 4.6 and Opus 4.7 through Converse.
- **Workaround**: Route Haiku traffic through Bedrock Invoke (column to the left), which is green for the same feature set. Sonnet 4.6 and Opus 4.7 can continue to use Converse for those features.
- **Status**: Under investigation in LiteLLM. Issue link pending.

### Bedrock Converse — `betas` field rejected on long-context requests

- **Affected cells**: `long_context_1m × bedrock_converse` (and any future row that needs an Anthropic `--betas` flag through Converse).
- **Symptom**: LiteLLM forwards `betas: ["context-1m-2025-08-07"]` as a top-level body field to AWS Bedrock's Converse API, which returns `400 The model returned the following errors: betas: Extra inputs are not permitted`. Converse expects vendor-specific extras under `additionalModelRequestFields`, not as a top-level `betas` array (the format Bedrock Invoke and Anthropic native accept).
- **Workaround**: Route 1M-context Anthropic traffic through Bedrock Invoke (which accepts `betas` directly), Anthropic native, or Vertex AI; all three are green for `long_context_1m`.
- **Status**: Under investigation in LiteLLM. Issue link pending.

### Bedrock Invoke — Opus 4.7 safety refusal on 1M-context

- **Affected cells**: `long_context_1m × bedrock_invoke` (Opus 4.7 tier only — Sonnet 4.6 passes).
- **Symptom**: A ~210k-token prompt that Anthropic-native and Vertex AI accept on the same Opus 4.7 model returns `stop_reason: "refusal"` with empty content when routed through Bedrock Invoke. The Bedrock tokenizer also reports 340k input tokens for the same prompt that Anthropic counts at 210k (~1.6×), which appears to push the request past a stricter safety threshold on the Bedrock-hosted snapshot.
- **Workaround**: Route 1M-context Opus 4.7 traffic through Anthropic native or Vertex AI for now. Sonnet 4.6 on Bedrock Invoke is unaffected.
- **Status**: Under investigation. Tokenizer divergence and safety-threshold differences between Bedrock-hosted and Anthropic-hosted Opus 4.7 are upstream concerns; tracking issue pending.

## Source

The matrix JSON lives at
[`src/data/compatibility-matrix.json`](https://github.com/BerriAI/litellm-docs/blob/main/src/data/compatibility-matrix.json).
The populator is in
[`tests/claude_code/cron_vm/`](https://github.com/BerriAI/litellm/tree/main/tests/claude_code/cron_vm)
on the main repo.
