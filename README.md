# uprox

The identity & access gateway for AI workloads. uprox unifies **human identity**
(users, organizations, sessions) and **machine identity** (services, agents,
revocable API tokens) behind a single **OpenAI-compatible gateway** that enforces
policy, encrypts upstream provider keys, and logs every request.

Built as a SvelteKit fullstack monolith: dashboard, REST API, and gateway all in
one app.

## Stack

- **SvelteKit** + TypeScript — UI, REST API, and gateway endpoints
- **Tailwind CSS v4** + **shadcn-svelte** + **@lucide/svelte** — dashboard UI
- **better-auth** (organization plugin) — human identity, sessions, orgs
- **Postgres** + **Drizzle ORM** — persistence
- **Node crypto** — AES-256-GCM secret encryption, sha256 token hashing

## Architecture

```
SvelteKit app
 ├── /app/*        Dashboard UI (auth-gated)
 ├── /api/*        REST API (session + org auth)
 ├── /v1/*         OpenAI-compatible gateway (machine-token auth)
 ├── auth          better-auth (users, orgs, sessions)
 ├── policy engine src/lib/server/policy.ts
 ├── token issuer  src/lib/server/tokens.ts
 ├── crypto        src/lib/server/crypto.ts (AES-256-GCM)
 └── audit log     src/lib/server/audit.ts
```

### Request flow (gateway)

```
Agent/App  --(Bearer uprox_live_…)-->  /v1/chat/completions
   1. resolve token  (sha256 lookup, check revoked/expired)
   2. route by model (claude-* → anthropic; gpt-*/o-series → openai or azure,
                       per the policy's preferred backend when both are configured)
   3. enforce policy (scopes, allowed providers, allowed models)
   4. rate limit     (per-token req/min ceiling → 429 + Retry-After)
   5. cache lookup   (exact-match hit replays the stored response for free)
   6. budget check   (per-service daily/monthly spend ceiling → 402)
   7. load + decrypt the org's upstream provider key
   8. proxy to the provider (streaming passthrough supported)
   9. write an audit log entry (status, cost, latency) + cache the response
```

### Policy controls

A policy attaches to a service and enforces, in addition to allowed
providers/models:

- **Rate limit** — requests/min per token (in-memory sliding window; `0` =
  unlimited). Over the limit returns `429` with a `Retry-After` header.
- **Budgets** — daily and monthly USD spend ceilings, summed per service from
  the audit log over UTC windows (`0` = unlimited). Exhausted returns `402`
  with `type: insufficient_quota`.
- **Cache** — exact-match response cache for chat, embeddings, and the
  Responses API. Unlike the access
  controls above, caching is an **org-wide setting** (Settings → Response cache,
  a default TTL in seconds; `0` = off) and applies to every service, with or
  without a policy. A policy's `cacheTtlSeconds` *overrides* the org default when
  set: blank = inherit, `0` = force off, `>0` = override the TTL. Identical
  requests across an org's services replay the stored upstream response at zero
  cost; responses carry an `x-uprox-cache: HIT|MISS` header. **Streaming is
  cached too**: the SSE body is buffered as it streams to the client (only if it
  completes cleanly) and replayed verbatim as `text/event-stream` on a hit — the
  `stream` flag is part of the cache key, so streamed and buffered variants never
  cross. Exact-match only — it keys on a canonicalized request body and never
  matches paraphrased prompts; responses above ~1 MB are not cached. Output-
  irrelevant fields (`user`, `metadata`, `store`) are stripped from the key so
  they don't cause spurious misses, and a Responses API call with `store: false`
  is never cached (its `id` isn't persisted upstream to replay against).

### Security model

- Machine tokens are **opaque** (`uprox_live_…`) and stored **only as a sha256
  hash** — like a password. The plaintext is shown exactly once at creation.
- Provider API keys are encrypted at rest with **AES-256-GCM**; only the
  last 4 characters are kept for display.
- The gateway never exposes upstream keys to clients — it swaps the machine
  token for the real key server-side.

## Setup

```sh
pnpm install

# 1. start Postgres (docker)
pnpm db:start            # or: docker compose up -d

# 2. configure env (see .env.example)
#    POSTGRES_HOST/PORT/USER/PASSWORD/DB, BETTER_AUTH_SECRET, ENCRYPTION_KEY
#    generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. apply the schema
pnpm db:migrate          # or: pnpm db:push

# 4. run
pnpm dev
```

Open http://localhost:5173, sign up (a personal organization is created
automatically), then:

1. **Providers** → add an OpenAI/Anthropic API key (for **Azure OpenAI**, also
   set your resource endpoint, e.g. `https://my-resource.openai.azure.com`).
   Azure is a drop-in for OpenAI: call deployments by name with no prefix. When
   both OpenAI and Azure are configured, pick which serves `gpt-*`/o-series
   models with a policy's **preferred backend**.
2. **Policies** (optional) → restrict providers/models
3. **Services** → create a machine identity
4. **Machine Tokens** → issue a token (copy it — shown once)

### Use it like the OpenAI SDK

```ts
import OpenAI from 'openai';

const client = new OpenAI({
	apiKey: 'uprox_live_…', // your machine token
	baseURL: 'http://localhost:5173/v1'
});

await client.chat.completions.create({
	model: 'gpt-4o',
	messages: [{ role: 'user', content: 'Hello' }]
});
```

## REST API

All under `/api`, authenticated via the dashboard session cookie:

| Method       | Path                 | Description                                       |
| ------------ | -------------------- | ------------------------------------------------- |
| GET/POST     | `/api/services`      | list / create services                            |
| PATCH/DELETE | `/api/services/:id`  | update / delete a service                         |
| GET/POST     | `/api/tokens`        | list / issue tokens (POST returns plaintext once) |
| DELETE       | `/api/tokens/:id`    | revoke a token                                    |
| GET/POST     | `/api/providers`     | list / upsert provider secrets                    |
| DELETE       | `/api/providers/:id` | remove a provider secret                          |
| GET/POST     | `/api/policies`      | list / create policies                            |
| PATCH/DELETE | `/api/policies/:id`  | update / delete a policy                          |
| GET          | `/api/audit`         | recent audit log entries                          |

## Gateway endpoints

- `POST /v1/chat/completions` (streaming supported)
- `POST /v1/responses` (OpenAI Responses API; streaming supported)
- `POST /v1/embeddings`
- `GET  /v1/models` (aggregated from configured providers)

## Scripts

- `pnpm dev` — dev server
- `pnpm build` / `pnpm preview` — production build
- `pnpm check` — typecheck
- `pnpm db:migrate` / `pnpm db:push` / `pnpm db:studio` — database
- `pnpm auth:schema` — regenerate the better-auth Drizzle schema

## Roadmap

Designed to stay a monolith for the MVP. When scale demands it, the gateway,
queue workers, audit pipeline, and realtime layer can be split out — without
changing the data model.
