import Image from '@theme/IdealImage';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Multi-region Deployments (Enterprise)

Learn how to deploy LiteLLM across multiple regions with centralized administration, accurate budget and rate limit enforcement, and fault tolerance.

:::info

✨ This requires LiteLLM Enterprise features.

[Enterprise Pricing](https://www.litellm.ai/#pricing)

[Get free 7-day trial key](https://www.litellm.ai/enterprise#trial)

:::

## Overview

A multi-region LiteLLM deployment runs proxy instances in more than one region or availability zone, usually so users get low-latency access from a nearby region and so a regional outage does not take down the whole gateway.

LiteLLM proxy instances are stateless. They keep almost nothing in process memory that has to survive a restart; everything that needs to be shared (keys, teams, budgets, spend, and optionally models) lives in three backing stores:

| Backing store | What it holds | Why it matters across regions |
|---|---|---|
| **PostgreSQL** | Virtual keys, teams, users, budgets, spend logs, and models when `store_model_in_db=true` | Every instance reads and writes the same logical database. Across regions this is the data you have to replicate |
| **Redis** | Cross-instance rate limit (RPM/TPM) counters and live spend counters for budget enforcement | Without a shared Redis, each instance enforces limits and budgets on its own; the effective limit becomes the per-instance limit multiplied by the number of instances |
| **Models** | The set of deployments each instance can route to, from local `config.yaml` or from the shared database | Each region typically routes to its own regional model endpoints. How you store models decides whether they stay regional or become globally visible |

The rest of this guide covers each of these in turn, then how to split admin traffic from LLM traffic, and finally how the whole thing behaves under failure.

If you would rather avoid all shared infrastructure and give each region its own fully independent database, Redis, and master key, see [High Availability Control Plane](./high_availability_control_plane.md), which manages independent per-region proxies from a single UI. The trade-off is that budgets, rate limits, and user management are then scoped per region rather than global.

## Architecture pattern: regional data planes + centralized admin

<Image img={require('../../img/scaling_architecture.png')} />

In the most common setup, each region runs one or more **data plane** instances that serve LLM traffic for users in that region, and a single **admin** instance (or small pool) serves the UI and management APIs. All of them share the same database and Redis so that a key created on the admin instance works in every region, and a budget is enforced globally.

Benefits of this split:

1. Users get low-latency LLM access from their own region
2. Administration happens in one place instead of being duplicated per region
3. You can lock the management APIs and UI down to the admin instance only
4. You avoid running admin infrastructure in every region

## 1. Database across regions

### What lives in the database

A single PostgreSQL database backs the whole deployment. It stores virtual keys, organizations, teams, users, budgets, audit and spend logs, and, when `store_model_in_db=true`, your model definitions. See [What is stored in the DB](./db_info.md) for the full table list.

Every proxy instance, in every region, reads and writes this same logical database. There is no per-region database in this architecture; that is what makes a key or budget you create once apply everywhere.

### Read and write patterns

Two things keep the database from becoming a per-request bottleneck, and both matter when you put regions far apart:

Authentication reads are cache-first. On each request the proxy checks Redis (or its in-memory cache) for the virtual key before falling back to a database read, so a warm cache means most requests never touch PostgreSQL for auth.

Spend and usage writes are asynchronous and batched. Spend updates are buffered and flushed on an interval (`proxy_batch_write_at`, default 60s) rather than written inline, so cross-region write latency does not sit in the request path. Key creation, team changes, and model edits, on the other hand, are synchronous writes that go to the primary.

### Replicating the database across regions

Pick one of these patterns based on how far apart your regions are and how much write latency you can tolerate.

**Single primary with regional read replicas.** Run the primary in one region and a read replica in each other region. This is the simplest option and works well when most cross-region traffic is reads (auth lookups that miss the cache, UI listing). The catch is that all writes (key creation, spend flushes, model edits) go to the single primary, so a write from a distant region pays the cross-region round trip, and a primary-region outage stops writes everywhere until you promote a replica. Point each instance's read traffic at its local replica and its writes at the primary.

**Globally distributed PostgreSQL.** Use a managed database built for multi-region, such as AWS Aurora Global Database, GCP Cloud SQL or AlloyDB cross-region replicas, Azure Cosmos DB for PostgreSQL, or CockroachDB. These give you a low-latency local endpoint in each region and handle replication and (for some) failover for you. This is the recommended option for deployments that need both low write latency and resilience to a regional outage. The behavior on a primary-region failure (automatic vs manual promotion, and how much replication lag you can lose) depends on the product, so confirm the failover characteristics of the one you pick.

**Independent databases per region.** If your regions have strict data residency requirements, or you do not want any shared database at all, give each region its own database and manage them from one UI with the [High Availability Control Plane](./high_availability_control_plane.md). Budgets, rate limits, and users are then per-region rather than global.

:::tip

Whichever option you choose, set a single `LITELLM_SALT_KEY` shared across every instance and region. It encrypts and decrypts the LLM credentials stored in the database, so all instances reading the same database must use the same salt key. See [Set LiteLLM Salt Key](./prod.md#8-set-litellm-salt-key).

:::

## 2. Redis across regions (required for accurate budgets and rate limits)

### Why Redis is required

Rate limits (RPM/TPM) and budgets are enforced against live counters. A single instance can keep those counters in memory, but the moment you run more than one instance, in-memory counters drift apart because each instance only ever sees its own traffic.

With a shared Redis, every instance increments the same atomic counter, so a 100 RPM key is 100 RPM no matter how many instances or regions serve it, and a $500 team budget blocks the request that crosses $500 regardless of which region spends it.

Without a shared Redis, each instance enforces independently. With three instances and a 100 RPM limit, you can serve up to 300 RPM, because each instance lets through 100 before blocking. Budgets behave the same way: each instance only counts the spend it personally saw, so the real total can sail past the configured limit before any single instance notices. For this reason Redis is a required component of any multi-instance or multi-region LiteLLM deployment that enforces limits or budgets, not an optional cache.

### Configuration

Configure Redis once and use it for both the router and the cache:

```yaml title="config.yaml"
router_settings:
  redis_host: os.environ/REDIS_HOST
  redis_port: os.environ/REDIS_PORT
  redis_password: os.environ/REDIS_PASSWORD

litellm_settings:
  cache: True
  cache_params:
    type: redis
    host: os.environ/REDIS_HOST
    port: os.environ/REDIS_PORT
    password: os.environ/REDIS_PASSWORD
```

Prefer separate `redis_host` / `redis_port` / `redis_password` over a single `redis_url`; see [Use Redis host/port/password, not redis_url](./prod.md#4-use-redis-porthost-password-not-redis_url). Redis 7.0+ is required.

### Teams that span regions

This is the part that trips people up. LiteLLM's limiter and budget counters are atomic operations against a single Redis keyspace. Accurate global enforcement requires every instance that shares a budget or limit to increment the same key, which means talking to the same Redis primary.

How you lay out Redis decides what "the limit" means:

**One Redis per region (limits and budgets are per-region).** Each region points at its own Redis. Enforcement is exact within a region and there is no cross-region latency on the limiter, but a team's limit is enforced once per region, so a team active in three regions can use up to three times its configured limit globally. This is the simplest and most fault-tolerant layout, and it is the right choice when teams are pinned to a single region or when per-region limits are acceptable.

**One shared Redis primary for all regions (limits and budgets are global and exact).** Every region's instances point at one Redis primary, so a team's budget and limit are enforced exactly no matter where it spends. The cost is that every request's limiter check makes a cross-region call to that primary, adding latency, and that primary is a regional single point of failure. Use this only when exact global enforcement matters more than the added latency, and put the primary in the region that carries the most traffic.

**Active-active replication.** Products like Redis Enterprise active-active (CRDT) replicate a writable Redis into every region with a local endpoint. This removes the cross-region latency, but the replication is eventually consistent, so two regions can each admit a request against the same budget before they converge, allowing a bounded overshoot. Treat this as "approximately global" enforcement; it is a good fit when you want low latency and roughly-global budgets but can tolerate small overshoot. Note that asynchronous global replicas with a single writable region (for example AWS ElastiCache Global Datastore) do not help here, because the atomic increments still have to reach the one writable primary.

There is no configuration that makes eventually-consistent replication give exact atomic global counters; that is a property of where the increment lands, not a LiteLLM setting. Choose the layout whose trade-off you can live with.

| Redis layout | Cross-region latency on limiter | Global enforcement accuracy | Fault tolerance |
|---|---|---|---|
| One Redis per region | None | Per-region (limit applies once per region) | A region's Redis only affects that region |
| One shared primary | High (every request) | Exact | Primary region is a single point of failure |
| Active-active (CRDT) | Low (local endpoint) | Approximate (bounded overshoot) | Each region has a local writable copy |

## 3. Models per region

### The problem

Each region almost always points at its own regional model endpoints (a `us-east-1` Bedrock account, an EU Azure deployment, and so on) for latency and data residency. The question is how to register those per-region deployments without every region seeing every other region's models.

There are two places a model can live, and they behave very differently across regions:

**Local `config.yaml` (per instance).** Models defined in a region's config file are visible only to the instances in that region. Nothing is shared. This is what you want for region-specific deployments.

**The shared database (`store_model_in_db=true`).** Models added through the UI or `/model/new` are written to the shared database and loaded by every instance in every region. This is convenient for central management but it means a model added "for the EU region" shows up and is callable in every region. This is the global-visibility surprise: there is no built-in notion of "this DB model belongs only to that region", so creating a separate alias per region in the UI is both cumbersome and leaky, because all of those aliases are visible globally.

### Recommended pattern: same public name, regional backend, local config

Give the same public `model_name` to a different backend in each region's local `config.yaml`. Clients everywhere call one model name and transparently hit their own region's endpoint.

<Tabs>
<TabItem value="us" label="US region config">

```yaml title="config.us.yaml"
model_list:
  - model_name: gpt-4o          # same public name in every region
    litellm_params:
      model: azure/gpt-4o
      api_base: https://us.openai.azure.com
      api_key: os.environ/AZURE_API_KEY_US
```

</TabItem>
<TabItem value="eu" label="EU region config">

```yaml title="config.eu.yaml"
model_list:
  - model_name: gpt-4o          # same public name in every region
    litellm_params:
      model: azure/gpt-4o
      api_base: https://eu.openai.azure.com
      api_key: os.environ/AZURE_API_KEY_EU
```

</TabItem>
</Tabs>

A client calling `gpt-4o` against the US endpoint reaches the US backend, and the same call against the EU endpoint reaches the EU backend. There are no per-region aliases to manage and no global leakage, because each region only loads its own model list. Budgets and limits stay global because keys, teams, and their counters still come from the shared database and Redis.

If you rely on central UI-based model management and want models in the database, keep that database the source of truth but accept that those models are global, and use tags (below) to control which deployment actually serves a request.

### Alternative: one model list, route by region tag

If you prefer a single shared model list (whether in the database or one config) that contains every region's deployment, use [tag-based routing](./tag_routing.md) to keep traffic regional. Tag each deployment with its region and enable tag filtering:

```yaml title="config.yaml"
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: azure/gpt-4o
      api_base: https://us.openai.azure.com
      api_key: os.environ/AZURE_API_KEY_US
      tags: ["us-east"]
  - model_name: gpt-4o
    litellm_params:
      model: azure/gpt-4o
      api_base: https://eu.openai.azure.com
      api_key: os.environ/AZURE_API_KEY_EU
      tags: ["eu-west"]

router_settings:
  enable_tag_filtering: True
```

A request tagged `us-east` (passed in the request body, the `x-litellm-tags` header, or attached to the calling team or key) routes to the US deployment; a request tagged `eu-west` routes to the EU one. Both share the public name `gpt-4o`. Attaching the region tag to each team or key means clients do not have to send it themselves. See [Tag Based Routing](./tag_routing.md) for team and key based tagging.

:::note

LiteLLM also has an `allowed_model_region` restriction, but it only understands the coarse buckets `"eu"` and `"us"` (set per end-user or customer). It is useful for EU data residency, but it cannot express arbitrary regions like `us-east-1` versus `us-west-2`. For anything finer-grained, use local per-region configs or tag-based routing as above.

:::

## 4. Splitting admin traffic from LLM traffic

In a multi-region deployment you usually want the management APIs and UI on a dedicated admin instance, and the regional instances serving only LLM traffic. LiteLLM controls this with three environment variables.

### Admin instance

The admin instance serves the UI and management APIs and does not serve LLM traffic:

```bash
DISABLE_LLM_API_ENDPOINTS=true      # LLM APIs disabled on this instance
DATABASE_URL=postgresql://user:pass@global-db:5432/litellm
LITELLM_MASTER_KEY=your-master-key
```

### Data plane (regional) instances

Regional instances serve LLM traffic with the management surface turned off:

```bash
DISABLE_ADMIN_UI=true           # No admin UI
DISABLE_ADMIN_ENDPOINTS=true    # No management endpoints
DATABASE_URL=postgresql://user:pass@regional-replica:5432/litellm
LITELLM_MASTER_KEY=your-master-key
```

### Environment variable reference

#### `DISABLE_ADMIN_UI`

Disables the LiteLLM Admin UI at `/ui`.

- **Default**: `false`
- **Data plane instances**: set to `true`
- **Admin instance**: leave as `false`

#### `DISABLE_ADMIN_ENDPOINTS`

:::info

✨ This is an Enterprise feature.

:::

Disables all management/admin API endpoints.

- **Default**: `false`
- **Data plane instances**: set to `true`
- **Admin instance**: leave as `false`

**Disabled when set**: `/key/*`, `/user/*`, `/team/*`, `/config/*`, and all other administrative endpoints.

**Still available**: `/chat/completions`, `/v1/*`, provider pass-through routes (`/vertex_ai/*`, `/bedrock/*`), `/health`, `/metrics`, and all other LLM API endpoints.

#### `DISABLE_LLM_API_ENDPOINTS`

:::info

✨ This is an Enterprise feature.

:::

Disables all LLM API endpoints.

- **Default**: `false`
- **Data plane instances**: leave as `false`
- **Admin instance**: set to `true`

**Disabled when set**: `/chat/completions`, `/v1/*`, and provider pass-through routes.

**Still available**: `/key/*`, `/user/*`, `/team/*`, `/config/*`, and all other administrative endpoints.

#### `LITELLM_UI_API_DOC_BASE_URL`

Optional override for the API Reference base URL used in the UI's sample code, for when the admin UI runs on a different host than the proxy.

## Fault tolerance summary

| Component | Failure mode | Recommended mitigation |
|---|---|---|
| Data plane instance | Region loses an instance | Run more than one instance per region behind a load balancer; scale horizontally with one worker per pod (see [Production best practices](./prod.md#3a-recommended-one-uvicorn-worker-per-pod)) |
| Whole region | Region goes offline | Route clients to a healthy region via DNS or a global load balancer; because instances are stateless, any region can serve any key |
| PostgreSQL primary | Primary region database fails | Use a globally distributed database with failover, or promote a read replica; set `allow_requests_on_db_unavailable: true` so cached keys keep serving during a brief outage (see [Production best practices](./prod.md#6-if-running-litellm-on-vpc-gracefully-handle-db-unavailability)) |
| Redis | Redis becomes unreachable | The proxy falls back to reseeding spend counters from the database, which bounds overspend but adds database load; run Redis in a highly available configuration (replica or cluster) |
| Admin instance | Admin instance is down | LLM traffic is unaffected because data plane instances do not depend on the admin instance at request time; only management and the UI are temporarily unavailable |

For the alternative where each region is fully independent (its own database, Redis, and master key) with no shared failure domain at all, see [High Availability Control Plane](./high_availability_control_plane.md).

## Usage patterns

### Client usage

Point clients at their regional endpoint for LLM requests:

```python
import openai

client_us = openai.OpenAI(
    base_url="https://us.company.com/v1",
    api_key="your-litellm-key"
)

client_eu = openai.OpenAI(
    base_url="https://eu.company.com/v1",
    api_key="your-litellm-key"
)

response = client_us.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

The same key works against any region because keys live in the shared database. Administration goes to the admin endpoint:

```python
import requests

response = requests.post(
    "https://admin.company.com/key/generate",
    headers={"Authorization": "Bearer sk-1234"},
    json={"duration": "30d"}
)
```

## Related documentation

- [High Availability Control Plane](./high_availability_control_plane.md) - independent per-region proxies managed from one UI
- [Production best practices](./prod.md) - Redis, database, and Kubernetes guidance
- [What is stored in the DB](./db_info.md) - the tables shared across regions
- [Tag Based Routing](./tag_routing.md) - routing traffic to regional deployments
- [Virtual Keys](./virtual_keys.md) - managing keys, teams, and budgets
- [Health Checks](./health.md) - monitoring instance health
