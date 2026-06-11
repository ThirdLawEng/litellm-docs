import Image from '@theme/IdealImage';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# ThirdLaw

[ThirdLaw](https://www.thirdlaw.io/) enforces runtime security policies on LLM traffic routed through the LiteLLM proxy. It evaluates prompts, responses, tool calls, and agent activity against your configured Laws and can block violations before they reach the model.

## Prerequisites

- **ThirdLaw Guardrail API Service** deployed and reachable from your LiteLLM host
- **LiteLLM proxy** installed and running
- **ThirdLaw credentials** — API base URL and API key (see Step 1 below)

Before LiteLLM can block traffic, your ThirdLaw administrator must configure **Laws** (policy rules) in ThirdLaw. See the [ThirdLaw FAQ](https://www.thirdlaw.io/faq) for platform setup, or contact [support@thirdlaw.io](mailto:support@thirdlaw.io) for integration help.

## Quick Start

### 1. Get your ThirdLaw credentials

Set up the ThirdLaw Guardrail API Service and obtain:

- `THIRDLAW_API_BASE`: your ThirdLaw Guardrail API base URL
- `THIRDLAW_API_KEY`: your ThirdLaw API key


### 2. Configure environment variables on the LiteLLM proxy host

```bash
export THIRDLAW_API_KEY="your-thirdlaw-guardrail-api-key"
export THIRDLAW_API_BASE="https://guardrails.thirdlaw.<your-domain>"
```

### 3. Manage guardrails

#### Supported Parameters

ThirdLaw supports the following parameters to control traffic flow between LiteLLM and ThirdLaw and what actions ThirdLaw can take on each request.

| Parameter | Env Variable | Default | Description |
| --- | --- | --- | --- |
| `mode` | — | required | `pre_call`, `post_call`, `during_call`, or a list (for example, `[pre_call, post_call]`). See [LiteLLM guardrail modes](/docs/proxy/guardrails/quick_start#supported-values-for-mode-event-hooks). |
| `default_on` | — | `false` | When `true`, runs the guardrail on every request without requiring clients to pass the guardrail name. See [default-on guardrails](/docs/proxy/guardrails/quick_start#default-on-guardrails). |
| `unreachable_fallback` | — | `fail_closed` | `fail_open` allows requests when ThirdLaw is unreachable or returns an error on awaited calls; `fail_closed` blocks them with `503`. Does not override policy block decisions (`403`). |
| `api_base` | `THIRDLAW_API_BASE` | required | ThirdLaw Guardrail API base URL. |
| `api_key` | `THIRDLAW_API_KEY` | optional | ThirdLaw API key. Required if not supplied another way. |
| `ingest_only` | — | `true` | When `true`, LiteLLM forwards events to ThirdLaw without waiting for a policy decision. When `false`, LiteLLM waits for ThirdLaw and can block or modify traffic. |
| `guardrail_timeout` | — | `60` | Timeout in seconds for awaited ThirdLaw calls. |
| `additional_headers` | — | none | Comma-separated list of incoming request header names LiteLLM forwards to ThirdLaw (for example, `x-request-id` for trace correlation). |

#### Recommended Settings for ThirdLaw

ThirdLaw recommends the following configuration to get started:

```yaml
guardrails:
  - guardrail_name: "thirdlaw"
    litellm_params:
      guardrail: thirdlaw
      mode: ["pre_call", "post_call"]
      api_base: os.environ/THIRDLAW_API_BASE
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
      ingest_only: true
      unreachable_fallback: fail_open   # optional: fail_open | fail_closed (default: fail_closed)
      guardrail_timeout: 60             # optional. Default: 60 seconds
      additional_headers: "x-request-id,x-correlation-id"  # optional: incoming request headers to forward
```

**Phase 1 — Monitor only (recommended to start).** With `ingest_only: true`, LiteLLM sends each request and response to ThirdLaw in the background. Traffic continues to your LLM without waiting for a policy decision, so latency stays low while ThirdLaw collects data.

**Phase 2 — Enforce policies.** When your ThirdLaw team has finished setup—defining what to inspect (*scopes*), how to inspect it (*evaluators*), and the rules to apply (*Laws*)—set `ingest_only: false`. LiteLLM will then wait for ThirdLaw before allowing traffic through. ThirdLaw can **allow**, **block** (return `403`), or **modify** the request or response.

See the [ThirdLaw FAQ](https://www.thirdlaw.io/faq) for help configuring Laws before you disable `ingest_only`.

#### Define Guardrail

Configure ThirdLaw in LiteLLM using the Admin UI or `config.yaml`.

<Tabs>
<TabItem value="ui" label="LiteLLM Admin UI">

#### 1. Open Guardrails

In the LiteLLM Admin UI, go to **Guardrails** in the sidebar.

<Image
  img={require('../../../img/providers/thirdlaw/add_new.png')}
  alt="LiteLLM Admin UI Guardrails page with Add New Guardrail button"
  style={{ width: '100%', maxWidth: '900px', height: 'auto' }}
/>

#### 2. Create a ThirdLaw guardrail

Click **Add New Guardrail** and select **ThirdLaw** as the provider.

<Image
  img={require('../../../img/providers/thirdlaw/create_page.png')}
  alt="Add New Guardrail modal with ThirdLaw selected as the provider"
  style={{ width: '100%', maxWidth: '900px', height: 'auto' }}
/>

#### 3. Set basic settings

| UI field | Recommended value | Notes |
| --- | --- | --- |
| **Guardrail name** | `thirdlaw` | Used when clients pass `"guardrails": ["thirdlaw"]` in requests |
| **Mode** | `pre_call`, `post_call` | See [Supported Parameters](#supported-parameters) for all options |
| **Default on** | Enabled | Runs on every request without requiring the guardrail name in the client request |

<Image
  img={require('../../../img/providers/thirdlaw/basic_info.png')}
  alt="ThirdLaw guardrail basic settings: guardrail name, mode, and Default on toggle"
  style={{ width: '100%', maxWidth: '900px', height: 'auto' }}
/>

#### 4. Connect to ThirdLaw

Enter your ThirdLaw Guardrail API credentials:

| UI field | Value |
| --- | --- |
| **API Base URL** | Your `THIRDLAW_API_BASE` (for example, `https://guardrails.thirdlaw.<your-domain>`) |
| **API Key** | Your `THIRDLAW_API_KEY`, or reference the environment variable if the UI supports it |

<Image
  img={require('../../../img/providers/thirdlaw/basic_params.png')}
  alt="ThirdLaw guardrail connection settings: API Base URL and API Key fields"
  style={{ width: '100%', maxWidth: '900px', height: 'auto' }}
/>

#### 5. Configure behavior (recommended for first deploy)

Match the [recommended settings](#recommended-settings-for-thirdlaw) above:

| UI field | Recommended value | Notes |
| --- | --- | --- |
| **Ingest only** | Enabled (`true`) | Monitor-only mode — see Phase 1 above |
| **Unreachable fallback** | `fail_open` | Keeps traffic flowing if ThirdLaw is temporarily unavailable |
| **Guardrail timeout** | `60` | Seconds to wait when enforcement is enabled |
| **Additional headers** | `x-request-id,x-correlation-id` | Optional — incoming request headers to forward to ThirdLaw |

<Image
  img={require('../../../img/providers/thirdlaw/additional_params.png')}
  alt="ThirdLaw guardrail advanced settings: ingest only, unreachable fallback, guardrail timeout, and additional headers"
  style={{ width: '100%', maxWidth: '900px', height: 'auto' }}
/>

Click **Save** (or **Create Guardrail**) to apply the configuration. Changes take effect without restarting the proxy.

#### 6. Enable enforcement when ready

After your ThirdLaw team has configured Laws, edit the guardrail in the UI and disable **Ingest only** to turn on blocking and modification (Phase 2 above).

<Image
  img={require('../../../img/providers/thirdlaw/update_settings.png')}
  alt="Edit ThirdLaw guardrail with Ingest only disabled to enable policy enforcement"
  style={{ width: '100%', maxWidth: '900px', height: 'auto' }}
/>

</TabItem>
<TabItem value="config" label="config.yaml">

#### 1. Update config.yaml

Add an entry in the `guardrails` section that references the ThirdLaw integration.

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
      api_key: os.environ/THIRDLAW_API_KEY
      default_on: true
      ingest_only: true
      unreachable_fallback: fail_open   # optional: fail_open | fail_closed (default: fail_closed)
      guardrail_timeout: 60             # optional. Default: 60 seconds
      additional_headers: "x-request-id,x-correlation-id"  # optional: incoming request headers to forward
```

#### 2. Start or restart the LiteLLM gateway

```bash
litellm --config config.yaml --detailed_debug
```

</TabItem>
</Tabs>


### 4. Test the integration

With `default_on: true`, the ThirdLaw guardrail runs automatically on every request:

```bash
curl -i http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-litellm-key>" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

To invoke the ThirdLaw guardrail explicitly on a specific request:

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

LiteLLM calls ThirdLaw at the hooks you configure in `mode` (typically `pre_call` and `post_call`). What changes between the two phases is whether LiteLLM **waits** for ThirdLaw before continuing. If you also use `during_call`, LiteLLM runs an awaited input check in parallel with the LLM call; tokens may be consumed before a block.

### Monitor-only (`ingest_only: true`)

LiteLLM sends each request to your LLM right away. Copies of the request and response are forwarded to ThirdLaw in the background for logging and analysis. LiteLLM does not wait for a policy decision at any stage, so latency stays low while ThirdLaw collects data.

```
Request → LiteLLM → LLM → response → caller
              ↓              ↓
         ThirdLaw       ThirdLaw
      (ingest only)  (ingest only)
```

### Enforce policies (`ingest_only: false`)

LiteLLM waits for ThirdLaw at each configured hook. ThirdLaw evaluates traffic against your configured **Laws** and returns **allow**, **block** (`403`), or **modify**.

**Input passes and output passes**

```
Request → LiteLLM → ThirdLaw (pre_call) → Allowed → LLM → response
  → ThirdLaw (post_call) → Allowed → caller
```

**Input violates a Law**

The request never reaches the LLM. LiteLLM returns `403` and sends blocked-event metadata to ThirdLaw.

```
Request → LiteLLM → ThirdLaw (pre_call) → Blocked → 403
```

**Input passes, but the response violates a Law**

The LLM completes the call, but LiteLLM blocks the response before returning it to the caller.

```
Request → LiteLLM → ThirdLaw (pre_call) → Allowed → LLM → response
  → ThirdLaw (post_call) → Blocked → 403
```

## Error Handling

When ThirdLaw cannot be reached or returns an error on an **awaited** call, LiteLLM uses `unreachable_fallback`. Policy block decisions (`403`) always block, regardless of this setting.

| Scenario | `unreachable_fallback: fail_closed` (default) | `unreachable_fallback: fail_open` |
| --- | --- | --- |
| ThirdLaw unreachable | Blocked, `503` | Allowed |
| ThirdLaw returns an error | Blocked, `503` | Allowed |
| ThirdLaw returns a block decision | Blocked, `403` | Blocked, `403` |

## Further Reading

- [ThirdLaw platform](https://www.thirdlaw.io/)
- [ThirdLaw FAQ](https://www.thirdlaw.io/faq)
- Integration support: [support@thirdlaw.io](mailto:support@thirdlaw.io)
