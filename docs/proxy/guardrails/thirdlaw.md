# ThirdLaw

Use [ThirdLaw](https://www.thirdlaw.io/) as a guardrail provider, enabling runtime security for all LLM traffic routed through the proxy. ThirdLaw is purpose-built to secure autonomous and agentic AI systems that inspects every request and response inline, risk-scores interactions, and enforces policy decisions to block harmful actions, data exposure, and unsafe behavior before they can occur.

ThirdLaw's key capabilities include:

- **AI Runtime Protection** - Enforce policy in-line so violations are contained before they spread.
- **Agent and Tool Controls** - Set boundaries on what agents can do, even when workflows get complex.
- **AI Data Protection** - Detect and block sensitive data across AI interactions.
- **AI Investigation and Response** - Replay prompts, outputs, and tool calls with investigation-ready evidence.
- **AI Governance** - Turn acceptable use into scoped “Laws” that apply across AI apps and agents.


The integration with thirdlaw uses a **two-entry guardrail pattern**:
- `input` (`pre_call`) — validates requests against your security policies before they reach the LLM
- `output` (`post_call`) — ingests requests and responses into ThirdLaw for monitoring and analysis

## Quick Start

### 1. Get Your ThirdLaw Credentials

Set up the ThirdLaw Guardrail API Service and grab:
- `THIRDLAW_API_BASE` — your Guardrail API Base
- `THIRDLAW_API_KEY` — your API key

### 2. Configure in `config.yaml`

#### Block + Ingest (recommended)

Use both entries below. This gives you:
- pre-call block decision
- post-call ingestion for allowed traffic

Keep these as two separate entries (`thirdlaw-input` and `thirdlaw-output`).

```yaml
guardrails:
  - guardrail_name: "thirdlaw-input"
    litellm_params:
      guardrail: thirdlaw
      mode: pre_call
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
      unreachable_fallback: fail_closed   # optional: fail_open | fail_closed (default: fail_closed)
      guardrail_timeout: 5                # optional, default: 5

  - guardrail_name: "thirdlaw-output"
    litellm_params:
      guardrail: thirdlaw
      mode: post_call
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
```

#### Monitor-only mode

If you only want logging/ingestion and no blocking, keep only `thirdlaw-ingest`.

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

#### Supported values for `mode`

- `pre_call` Run **before** LLM call, on **input**
- `post_call` Run **after** LLM call, on **input & output**

### 3. Test request

```shell
curl -i http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your litellm key>" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

If a request gets blocked:

```json
{
  "error": {
    "message": "The request is forbidden under ThirdLaw Acceptable Use Policy",
    "type": "None",
    "param": "None",
    "code": "403"
  }
}
```

## How It Works

When an LLM request arrives, the ThirdLaw integration hands the payload to the ThirdLaw Guardrail Engine, which evaluates it against your configured laws and returns the verdict. Approved requests are forwarded to the LLM provider. Responses are sent back through the engine for output guardrail checks before being delivered to the caller. Every decision flows into the ThirdLaw dashboard for monitoring, threat analysis, and remediation.

**Block + Ingest mode:**
```
Request → LiteLLM → ThirdLaw guardrail check
  → Allowed  → forward to LLM → ingest response
  → Blocked  → ingest blocked marker → 403 error
```

**Monitor-only mode:**
```
Request → LiteLLM → forward to LLM → get response
  → Send to ThirdLaw (guardrails + ingest) → log only
```

## Event Behavior

| Entry | LiteLLM hook | ThirdLaw call behavior |
|------|---|---|
| `thirdlaw-input` | `pre_call` | Awaited call with `guardrails=true`, `ingest_data=false` |
| `thirdlaw-output` | `post_call` | Fire-and-forget call with `guardrails=true`, `ingest_data=true` |

When blocked in `pre_call`, LiteLLM sends one fire-and-forget ingest payload with blocked metadata and returns `403`.

## Supported Parameters

| Parameter | Env Variable | Default | Description |
|-----------|-------------|---------|-------------|
| `api_base` | `THIRDLAW_API_BASE` | *required* | ThirdLaw Guardrail API Base URL |
| `api_key` | `THIRDLAW_API_KEY` | *required* | API key (sent as `Authorization` header) |
| `unreachable_fallback` | — | `fail_closed` | `fail_open` or `fail_closed` |
| `guardrail_timeout` | — | `5` | Timeout in seconds |
| `default_on` | — | `true` (recommended) | Enables the guardrail entry by default |

## Error Handling

| Scenario | `fail_closed` (default) | `fail_open` |
|----------|------------------------|-------------|
| ThirdLaw unreachable | ❌ Blocked (503) | ✅ Passes through |
| ThirdLaw returns error | ❌ Blocked (503) | ✅ Passes through |
| Guardrail says no | ❌ Blocked (403) | ❌ Blocked (403) |

In case you want to reach out to the ThirdLaw team, contact them at [support@thirdlaw.io](mailto:support@thirdlaw.io).
