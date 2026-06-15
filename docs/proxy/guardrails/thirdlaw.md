# ThirdLaw

[ThirdLaw](https://www.thirdlaw.io/) adds policy enforcement for LLM traffic routed through LiteLLM. LiteLLM sends guardrail inputs to ThirdLaw at configured hook points. ThirdLaw applies your configured Laws and returns an action, such as allowing the traffic, blocking it, or returning modified text.
****

## How LiteLLM and ThirdLaw Work Together

A **LiteLLM guardrail** tells LiteLLM when to send traffic to an external provider. A **ThirdLaw Law** is a policy in ThirdLaw that defines what to inspect and what action to take. When you configure a LiteLLM guardrail with ThirdLaw as the provider, LiteLLM sends traffic to ThirdLaw at the hook points you configure. ThirdLaw applies any matching Laws and returns a decision to LiteLLM.

```
Caller → LiteLLM → ThirdLaw → allow / block / modify → LiteLLM → LLM
```

The configuration below:

```yaml
guardrails:
  - guardrail_name: "thirdlaw"
    litellm_params:
      guardrail: thirdlaw
      mode: ["pre_call", "post_call"]
      default_on: true
```

means:

- `guardrail_name: "thirdlaw"` is the name clients use to invoke this guardrail per request.
- `guardrail: thirdlaw` tells LiteLLM to use the ThirdLaw provider.
- `mode: ["pre_call", "post_call"]` sends traffic to ThirdLaw before the model call and after the model response.
- `default_on: true` applies this guardrail to every request automatically.

## Prerequisites

**Existing ThirdLaw customers:** Your API base URL and API key were provided during deployment. If you do not have them, contact your ThirdLaw representative or email [support@thirdlaw.io](mailto:support@thirdlaw.io).

**New to ThirdLaw:** Visit [thirdlaw.io/contact](https://www.thirdlaw.io/contact) to get started. ThirdLaw will provision your environment and provide the credentials you need.

You also need LiteLLM proxy installed and running. If you have not set that up yet, see the [LiteLLM proxy quickstart](https://docs.litellm.ai/docs/proxy/quick_start).

> **Note:** You do not need to configure any Laws before starting. With no blocking Laws configured, ThirdLaw allows all traffic. Laws are only required when you are ready to enforce policy.
> 

## Quick Start

### 1. Set environment variables

Set your ThirdLaw credentials on the LiteLLM proxy host:

```bash
export THIRDLAW_API_KEY="your-thirdlaw-api-key"
export THIRDLAW_API_BASE="https://api.thirdlaw.<your-domain>"
```

Use the actual API base URL provided by your ThirdLaw administrator. You can also supply these values directly in `config.yaml` or the LiteLLM Admin UI rather than as environment variables. Both approaches are shown below.

### 2. Configure the guardrail

### config.yaml

Add a ThirdLaw entry under `guardrails`:

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
      mode: ["pre_call", "post_call"]
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY       # omit if not required by your deployment
      default_on: true
      guardrail_timeout: 60
      additional_headers: "x-request-id,x-correlation-id"
```

### LiteLLM Admin UI

1. Open **Guardrails** from the sidebar.
2. Click **Add New Guardrail** and select **ThirdLaw** as the provider.
3. Set **Guardrail name** to `thirdlaw`.
4. Set **Mode** to `pre_call` and `post_call`.
5. Enable **Default on**.
6. Enter your ThirdLaw API base URL and API key. You can paste values directly or reference the environment variables set in step 1.
7. Set **Guardrail timeout** to `60`.
8. Optionally set **Additional headers** to `x-request-id,x-correlation-id` to forward those incoming request headers to ThirdLaw for policy evaluation context.
9. Click **Save**.

Admin UI changes take effect without restarting the proxy.

### 3. Start the LiteLLM gateway

If you configured ThirdLaw in `config.yaml`, start or restart the gateway:

```bash
litellm --config config.yaml --detailed_debug
```

### 4. Verify the gateway is running

```bash
curl -i http://localhost:4000/health
```

### 5. Test the integration

With `default_on: true`, LiteLLM sends every request through the ThirdLaw integration automatically:

```bash
curl -i http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-litellm-key>" \
  -H "x-request-id: test-001" \
  -H "x-correlation-id: thirdlaw-test" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

Check the response headers for `x-litellm-applied-guardrails` to confirm LiteLLM applied the guardrail.

To invoke the guardrail explicitly on a single request without `default_on`:

```bash
curl -i http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-litellm-key>" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "guardrails": ["thirdlaw"]
  }'
```

## Parameter Reference

Parameters with an environment variable alternative can be supplied either way. If both are set, the inline value takes precedence.

| Parameter | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `guardrail` | None | Required | Provider string. Must be `thirdlaw`. |
| `mode` | None | Required | LiteLLM hook point. Supported values: `pre_call`, `post_call`, `during_call`, or a list such as `["pre_call", "post_call"]`. See [LiteLLM guardrail modes](https://docs.litellm.ai/docs/proxy/guardrails/quick_start#supported-values-for-mode-event-hooks). |
| `default_on` | None | `false` | When `true`, LiteLLM sends every request through this guardrail automatically. When `false`, clients must pass `"guardrails": ["thirdlaw"]` in each request. See [default-on guardrails](https://docs.litellm.ai/docs/proxy/guardrails/quick_start#default-on-guardrails). |
| `api_base` | `THIRDLAW_API_BASE` | Required | ThirdLaw API base URL. |
| `api_key` | `THIRDLAW_API_KEY` | -- | ThirdLaw API key. Required if your ThirdLaw deployment uses API key authentication. Omit if your deployment is secured by a network trust boundary. |
| `unreachable_fallback` | None | `fail_closed` | Controls LiteLLM behavior when ThirdLaw is unavailable or returns a non-policy error. `fail_closed` blocks the request with `500`. `fail_open` allows the request to continue. A block decision from ThirdLaw always returns `400` regardless of this setting. |
| `guardrail_timeout` | None | `60` | Timeout in seconds when waiting for ThirdLaw. |
| `additional_headers` | None | None | Comma-separated list of inbound request header names whose values ThirdLaw should receive. All inbound headers are forwarded, but only headers listed here have their actual values exposed; others are forwarded as `[present]`. Example: `x-request-id,x-correlation-id`. |

## ThirdLaw Actions

ThirdLaw returns an action to LiteLLM. The integration handles these actions as follows:

| ThirdLaw action | LiteLLM behavior |
| --- | --- |
| `NONE` | Allows traffic unchanged. |
| `GUARDRAIL_INTERVENED` | Uses the `texts` returned by ThirdLaw. This can be used for modified or redacted text. |
| `BLOCKED` | Raises a LiteLLM guardrail exception and does not continue with the original traffic. |

## How It Works

LiteLLM calls ThirdLaw at the hook points configured in `mode`. The sections below describe what happens at each hook.

### `pre_call`

Runs before the LLM call on the input. If ThirdLaw returns `NONE` or `GUARDRAIL_INTERVENED`, LiteLLM continues using the allowed or modified text. If ThirdLaw returns `BLOCKED`, the request does not reach the model.

```
Request → LiteLLM → ThirdLaw (pre_call) → allow/modify → LLM
Request → LiteLLM → ThirdLaw (pre_call) → block → guardrail error
```

### `post_call`

Runs after the LLM call on the input and output. If ThirdLaw returns `NONE` or `GUARDRAIL_INTERVENED`, LiteLLM continues using the allowed or modified text. If ThirdLaw returns `BLOCKED`, LiteLLM raises a guardrail exception instead of returning the original model response.

```
Request → LiteLLM → LLM → response → ThirdLaw (post_call) → allow/modify → caller
Request → LiteLLM → LLM → response → ThirdLaw (post_call) → block → guardrail error
```

### `during_call`

Runs in parallel with the LLM call on the input. LiteLLM does not return the model response until the ThirdLaw check completes. If ThirdLaw blocks the request, LiteLLM returns the guardrail error instead of the model response. Model tokens may still be consumed because the LLM call has already started.

```
Request → LiteLLM ┬→ LLM call
                  └→ ThirdLaw (during_call)
                          ↓
                   allow / modify / block
                   before response returned
```

## Error Handling

When ThirdLaw is unreachable, times out, or returns a non-policy error, LiteLLM uses `unreachable_fallback`. A block decision from ThirdLaw always returns `400` regardless of this setting.

| Scenario | `unreachable_fallback: fail_closed` (default) | `unreachable_fallback: fail_open` |
| --- | --- | --- |
| ThirdLaw unreachable | Blocked, `500` | Allowed |
| ThirdLaw times out | Blocked, `500` | Allowed |
| ThirdLaw returns a non-policy error | Blocked, `500` | Allowed |
| ThirdLaw returns a block decision | Blocked, `400` | Blocked, `400` |

A policy block returns HTTP `400`. The response body format may vary by LiteLLM version. Example:

```json
{
  "error": {
    "message": "The request was blocked by a configured ThirdLaw policy.",
    "type": "guardrail_blocked",
    "param": null,
    "code": "400"
  }
}
```

## Further Reading

- [ThirdLaw platform](https://www.thirdlaw.io/)
- [LiteLLM Guardrails Quick Start](https://docs.litellm.ai/docs/proxy/guardrails/quick_start)
- [LiteLLM Guardrail Providers](https://docs.litellm.ai/docs/guardrail_providers)
- Integration support: [support@thirdlaw.io](mailto:support@thirdlaw.io)