# ThirdLaw

[ThirdLaw](https://www.thirdlaw.io/) enforces runtime security policies on LLM traffic routed through the LiteLLM proxy. It evaluates prompts, responses, tool calls, and agent activity against your configured Laws and can block violations before they reach the model.

## Quick Start

### 1. Get your ThirdLaw credentials

Set up the ThirdLaw Guardrail API Service and obtain:

- `THIRDLAW_API_BASE`: your ThirdLaw Guardrail API base URL
- `THIRDLAW_API_KEY`: your ThirdLaw API key

### 2. Define guardrails in `config.yaml`

### Block + Ingest (recommended)

```yaml
model_list:
  - model_name: gpt-5.5
    litellm_params:
      model: openai/gpt-5.5
      api_key: os.environ/OPENAI_API_KEY

guardrails:
  - guardrail_name: "thirdlaw-input"
    litellm_params:
      guardrail: thirdlaw
      mode: pre_call
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
      unreachable_fallback: fail_closed   # optional: fail_open | fail_closed. Default: fail_closed
      guardrail_timeout: 5                # optional. Default: 60 seconds
      additional_headers: "x-request-id,x-correlation-id"  # optional: comma-separated header names to forward

  - guardrail_name: "thirdlaw-output"
    litellm_params:
      guardrail: thirdlaw
      mode: post_call
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
```

### Monitor-only mode

To ingest traffic without blocking, use `thirdlaw-output` only:

```yaml
guardrails:
  - guardrail_name: "thirdlaw-output"
    litellm_params:
      guardrail: thirdlaw
      mode: post_call
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
```

### Supported values for `mode`

- `pre_call`: runs before the LLM call on input. Can block requests that violate configured Laws.
- `post_call`: runs after the LLM call on input and output. Used for monitoring, analysis, and investigation.

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
    "guardrails": ["thirdlaw-input", "thirdlaw-output"]
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

The `thirdlaw-input` guardrail evaluates each request before it reaches the model. Allowed requests are forwarded to the LLM provider. After the model responds, `thirdlaw-output` sends request and response data to ThirdLaw for monitoring and investigation. Blocked requests return `403` and send metadata to ThirdLaw.

**Block + Ingest mode:**

```
Request → LiteLLM → ThirdLaw pre-call policy check
  → Allowed → forward to LLM → response → ThirdLaw post-call ingest → caller
  → Blocked → ingest blocked metadata → 403 error
```

**Monitor-only mode:**

```
Request → LiteLLM → forward to LLM → response → ThirdLaw post-call ingest → caller
```

## Event Behavior

| Entry | LiteLLM hook | ThirdLaw call behavior |
| --- | --- | --- |
| `thirdlaw-input` | `pre_call` | Awaited policy check (`guardrails=true`, `ingest_data=false`). Blocks requests that violate configured Laws. |
| `thirdlaw-output` | `post_call` | Fire-and-forget ingest (`guardrails=true`, `ingest_data=true`). Sends request and response data for monitoring and investigation. |

When blocked in `pre_call`, LiteLLM sends a fire-and-forget ingest payload with blocked metadata and returns `403`.

> **Note:** The call behavior details above reflect the current `/beta` endpoint. Flags and behavior may change before the endpoint reaches general availability.
> 

## Supported Parameters

| Parameter | Env Variable | Default | Description |
| --- | --- | --- | --- |
| `api_base` | `THIRDLAW_API_BASE` | required | ThirdLaw Guardrail API base URL |
| `api_key` | `THIRDLAW_API_KEY` | required | ThirdLaw API key |
| `unreachable_fallback` | none | `fail_closed` | Behavior when ThirdLaw is unreachable. `fail_open` or `fail_closed`. |
| `guardrail_timeout` | none | `60` | Timeout in seconds for the ThirdLaw guardrail call. |
| `additional_headers` | none | none | Comma-separated list of header names that will be forwarded to the guardrails. |
| `default_on` | none | `true` recommended | Runs the guardrail by default on matching LiteLLM requests. |

## Error Handling

| Scenario | `fail_closed` (default) | `fail_open` |
| --- | --- | --- |
| ThirdLaw unreachable | Blocked, `503` | Allowed |
| ThirdLaw returns an error | Blocked, `503` | Allowed |
| ThirdLaw returns a block decision | Blocked, `403` | Blocked, `403` |

For help with the ThirdLaw LiteLLM integration, contact [support@thirdlaw.io](mailto:support@thirdlaw.io).