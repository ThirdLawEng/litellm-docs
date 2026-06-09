---
slug: thirdlaw-partnership
title: "LiteLLM × ThirdLaw: Runtime Security for Agentic AI at the Gateway"
date: 2026-06-09T10:00:00
authors:
  - krrish
description: "Enforce ThirdLaw policies inline on every LLM request through the LiteLLM proxy — block violations before they reach models, and ingest full interaction evidence for investigation."
tags: [partnership, security, guardrails, thirdlaw]
hide_table_of_contents: false
---

![LiteLLM x ThirdLaw Partnership](/img/thirdlaw.svg)

[ThirdLaw](https://www.thirdlaw.io/) now runs natively inside the LiteLLM proxy as a guardrail provider — runtime enforcement and investigation for every model, agent, and tool call routed through your gateway.

{/* truncate */}

As teams move from chatbots to autonomous agents, security has to move with them. Prompt filters alone don't cover tool abuse, data exfiltration across multi-step workflows, or policy violations that only show up in agent behavior. ThirdLaw is built for that layer: it inspects requests and responses inline, risk-scores interactions against your enterprise **Laws**, and blocks harmful actions before they spread.

LiteLLM sits at the integration point where all LLM traffic converges. Wiring ThirdLaw in there means one policy surface across 100+ providers — no app-level SDK changes, no per-team guardrail drift.

## Block + ingest in one integration

The integration uses a **two-entry guardrail pattern**:

- **`thirdlaw-input` (`pre_call`)** — evaluates requests against your Laws before the LLM is called. Violations return `403` immediately.
- **`thirdlaw-output` (`post_call`)** — fire-and-forget ingestion of allowed traffic (prompts, outputs, tool calls) into ThirdLaw for monitoring, threat analysis, and investigation.

Run both entries for the recommended setup: enforce policy on the way in, preserve evidence on the way out. If you only need visibility without blocking, configure monitor-only mode with the post-call entry alone.

```
Request → LiteLLM → ThirdLaw pre_call check
  → Allowed  → forward to LLM → ingest response (post_call)
  → Blocked  → ingest blocked marker → 403 error
```

ThirdLaw defaults to **fail closed** when the guardrail service is unreachable — requests are blocked rather than silently passing through. You can switch to `fail_open` if your deployment requires it.

## What you get

- **AI runtime protection** — enforce policy inline so violations are contained before they reach downstream systems.
- **Agent and tool controls** — set boundaries on what agents can do, even in complex multi-step workflows.
- **AI data protection** — detect and block sensitive data across AI interactions.
- **Investigation-ready evidence** — replay prompts, outputs, and tool calls from the ThirdLaw dashboard.
- **Governance at scale** — turn acceptable use into scoped Laws that apply across AI apps and agents.

Configure both guardrail entries in your existing `config.yaml`, point them at your ThirdLaw Guardrail API, and every request through the proxy is covered.

**Get started:** [ThirdLaw guardrail setup guide](../../docs/proxy/guardrails/thirdlaw)

**Learn more:** [ThirdLaw platform →](https://www.thirdlaw.io/)
