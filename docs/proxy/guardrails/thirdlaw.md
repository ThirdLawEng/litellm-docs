# ThirdLaw

[ThirdLaw](https://www.thirdlaw.io/) enforces runtime security policies on LLM traffic routed through the LiteLLM proxy. It evaluates prompts, responses, tool calls, and agent activity against your configured Laws and can block violations before they reach the model.

## Quick Start

### 1. Get your ThirdLaw credentials

Set up the ThirdLaw Guardrail API Service and obtain:

- `THIRDLAW_API_BASE`: your ThirdLaw Guardrail API base URL
- `THIRDLAW_API_KEY`: your ThirdLaw API key

### 2. Define guardrails in `config.yaml`

#### Block + Ingest (recommended)

You can define one or more guardrails depending on how you want to treat each mode (`pre_call`, `post_call`, or `during_call`). You may configure all modes to enforce the same behavior, or set `ingest_only: true` on specific modes (for example, on `post_call`) if you want certain stages to only ingest traffic for monitoring rather than blocking.

```yaml
model_list:
  - model_name: gpt-5.5
    litellm_params:
      model: openai/gpt-5.5
      api_key: os.environ/OPENAI_API_KEY

guardrails:
  - guardrail_name: "thirdlaw"
    litellm_params:
      guardrail: thirdlaw
      mode: ["pre_call", "post_call", "during_call"]
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
      unreachable_fallback: fail_closed   # optional: fail_open | fail_closed (default: fail_closed)
      guardrail_timeout: 60               # optional. Default: 60 seconds
      additional_headers: "x-request-id,x-correlation-id"  # optional: incoming request headers to forward
```

### Monitor-only mode

To ingest traffic without blocking, use `thirdlaw-monitor` only with `ingest_only` set to `true`:

```yaml
guardrails:
  - guardrail_name: "thirdlaw-monitor"
    litellm_params:
      guardrail: thirdlaw
      mode: post_call
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
      ingest_only: true
```

For ingest-only visibility with less overhead, you can limit `mode` to `post_call`.

### `mode` and `ingest_only`

| `mode` | When it runs | With `ingest_only: false` (default) | With `ingest_only: true` |
| --- | --- | --- | --- |
| `pre_call` | Before the LLM call | Awaited policy check on input. Can block with `403` or modify the request. | Fire-and-forget ingest. Does not block. |
| `post_call` | After the LLM call | Awaited policy check on response. Can block with `403` or modify the response | Same — ingest only. |
| `during_call` | In parallel with the LLM call | Awaited check on input. Response is held until the check completes. LLM tokens are still consumed if the check fails. Can block with `403` but cannot modify. | Fire-and-forget ingest. Does not block. |

**`ingest_only`** is a guardrail-level flag:

- `false` (default): blocking modes (`pre_call`, `post_call`) await ThirdLaw and can return `403` or modify the request or response. `during_call` can only be allowed or blocked but cannot be modified.
- `true`: every configured mode ingests without awaiting a block decision. Use this for monitor-only deployments.

Combine modes as needed. Block + Ingest is `mode: [pre_call, post_call]` with `ingest_only: false`. Reserve `during_call` when you want input scanning in parallel with the LLM call and accept that tokens may be consumed before a block.

### 3. Start LiteLLM Gateway

```bash
litellm --config config.yaml --detailed_debug
```

### 4. Test the integration

With `default_on: true`, ThirdLaw guardrails run automatically on every request:

```bash
curl -i http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-litellm-key>" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

To invoke ThirdLaw guardrails explicitly on a specific request:

```bash
curl -i http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-litellm-key>" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "guardrails": ["thirdlaw"]
  }'
```

If a request violates a configured Law:

```json
{
  "error": {
    "message": "The request is forbidden under ThirdLaw policy",
    "type": "None",
    "param": "None",
    "code": "403"
  }
}
```

## How It Works

**Block + Ingest mode** (`ingest_only: false`):
The `thirdlaw` guardrail evaluates each request before it reaches the model. Allowed requests are forwarded to the LLM provider. After the model responds, `thirdlaw` sends request and response data to ThirdLaw for monitoring and investigation. Blocked requests return `403` and send metadata to ThirdLaw.


```
Request → LiteLLM → ThirdLaw pre-call policy check
  → Allowed → forward to LLM → response → ThirdLaw post-call ingest → caller
  → Blocked → ingest blocked metadata → 403 error
```

**Monitor-only** (`ingest_only: true`):

```
Request → LiteLLM → forward to LLM → response → ThirdLaw post-call ingest → caller
```

## Event Behavior

| LiteLLM hook | `ingest_only` | ThirdLaw call behavior |
| --- | --- | --- |
| `pre_call` | `false` | Awaited policy check. Blocks requests that violate configured Laws. |
| `pre_call` | `true` | Fire-and-forget ingest. Does not block. |
| `post_call` | `false` or `true` | Fire-and-forget ingest of request and response data. |
| `during_call` | `false` | Awaited policy check on input. Can block delivery of the response. |
| `during_call` | `true` | Fire-and-forget ingest. Does not block. |

When blocked in `pre_call`, LiteLLM sends a fire-and-forget ingest payload with blocked metadata and returns `403`.

> **Note:** The call behavior details above reflect the current `/beta` endpoint. Flags and behavior may change before the endpoint reaches general availability.
> 

## Supported Parameters

| Parameter | Env Variable | Default | Description |
| --- | --- | --- | --- |
| `mode` | — | required | `pre_call`, `post_call`, `during_call`, or a list (for example, `[pre_call, post_call]`). |
| `ingest_only` | — | `false` | When `true`, all configured modes ingest without awaiting block decisions. |
| `api_base` | `THIRDLAW_API_BASE` | required | ThirdLaw Guardrail API base URL. |
| `api_key` | `THIRDLAW_API_KEY` | required | ThirdLaw API key. |
| `unreachable_fallback` | — | `fail_closed` | `fail_open` or `fail_closed` when ThirdLaw is unreachable or returns an error on awaited checks (`pre_call`, `during_call` with `ingest_only: false`). Does not override a policy block decision. |
| `guardrail_timeout` | — | `60` | Timeout in seconds for awaited ThirdLaw calls. |
| `additional_headers` | — | none | Comma-separated list of incoming request header names LiteLLM forwards to ThirdLaw (for example, `x-request-id` for trace correlation). |
| `default_on` | — | `false` | When `true`, runs the guardrail on every request without requiring clients to pass the guardrail name. |

## Error Handling

| Scenario | `fail_closed` (default) | `fail_open` |
| --- | --- | --- |
| ThirdLaw unreachable | Blocked, `503` | Allowed |
| ThirdLaw returns an error | Blocked, `503` | Allowed |
| ThirdLaw returns a block decision | Blocked, `403` | Blocked, `403` |

## Further Reading

- [ThirdLaw platform](https://www.thirdlaw.io/)
- [ThirdLaw FAQ](https://www.thirdlaw.io/faq)
- Integration support: [support@thirdlaw.io](mailto:support@thirdlaw.io)
