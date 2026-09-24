# Admin REST API

The dashboard's resources (services, tokens, provider keys, policies, pricing, audit) can be
managed over a JSON API under `/api`. This is the **admin** API; the gateway surface that
applications call with a machine token (`/v1/*`, `/openai/*`, Gemini) is documented in the
README.

A runnable end-to-end example is [`examples/provision.mjs`](../examples/provision.mjs).

## Authentication

The admin API uses the same **session cookie** as the dashboard (better-auth). Machine tokens
(`uprox_live_…`) are not accepted here.

1. Sign in with `POST /api/auth/sign-in/email` (or `POST /api/auth/sign-up/email`) and a JSON body
   `{ "email", "password" }` (sign-up also takes `name`).
2. Send the returned `Set-Cookie` values back as `Cookie` on every request.
3. Send an `Origin` header matching the instance URL (`ORIGIN`) on mutating requests.

### Permissions

Every endpoint requires a signed-in user (`401` otherwise). Reads (`GET`) are open to every role.
Writes require a capability; missing it is a `403`.

| Capability         | owner | admin | member                                    |
| ------------------ | ----- | ----- | ----------------------------------------- |
| `providers:manage` | yes   | yes   | no                                        |
| `policies:manage`  | yes   | yes   | no                                        |
| `pricing:manage`   | yes   | yes   | no                                        |
| `services:manage`  | yes   | yes   | only if "members can manage services" set |
| `tokens:manage`    | yes   | yes   | only if "members can manage tokens" set   |

## Conventions

- **Bodies** are JSON objects. Invalid JSON or a non-object body is a `400`.
- **Unknown fields are ignored.** Each endpoint reads an explicit list of fields (below); anything
  else, including read-only columns such as `id` or `createdAt`, is silently dropped.
- **Tri-state fields** (marked _nullable_): omit the key to leave the value unchanged (or use the
  default on create), send `null` to clear it (for inline limits: inherit from the policy or the
  instance default), send a value to set it. For scalar fields `""` is treated like `null`.
- **Numbers** may be sent as JSON numbers or numeric strings. Prices, budgets, rate limits and
  TTLs must be `>= 0`; fields marked _integer_ reject fractions.
- **Arrays of strings**: entries are trimmed and blank entries dropped. `[]` is a real value
  ("allow all"), distinct from `null`.
- **Ids** are UUIDs. A malformed id in the path is a `404`; a malformed id in a body field is a
  `400`. A syntactically valid id that references nothing (e.g. an unknown `policyId`) is a `400`.
- **PATCH** updates only the fields sent. A PATCH body containing none of the accepted fields is a
  `400` (`No updatable fields provided`).
- **Status codes**: list `200` (JSON array), create `201` (created row), update `200` (updated
  row), delete `204` (no body; idempotent, also for ids that no longer exist). Exception: token
  revocation, see below.

### Errors

Every error response has a JSON body:

```json
{ "error": "rateLimitPerMinute must be a non-negative integer", "field": "rateLimitPerMinute" }
```

| Status | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| `400`  | Invalid body or field (`field` names the offending key when there is one)            |
| `401`  | Not signed in                                                                        |
| `403`  | Signed in but missing the capability                                                 |
| `404`  | Unknown or malformed id                                                              |
| `409`  | Conflicts with an existing record                                                    |
| `500`  | Unexpected server error (`{ "error": "Internal server error" }`), logged server-side |

`401` and `403` responses also carry `message` (same text as `error`) for clients written against
the earlier SvelteKit error shape.

## Services

A service is a machine identity that owns tokens and may carry limits of its own.

### `GET /api/services`

Active (non-retired) services, newest first.

### `POST /api/services` (`services:manage`)

| Field              | Type                                | Notes                                   |
| ------------------ | ----------------------------------- | --------------------------------------- |
| `name`             | string, required                    |                                         |
| `type`             | string                              | free-form, default `app`                |
| `description`      | string                              |                                         |
| `policyId`         | uuid                                | reusable preset                         |
| `providerSecretId` | uuid                                | pin a specific provider key             |
| `allowedModels`    | string[], nullable                  | model allowlist (trailing `*` globbing) |
| inline limits      | see [Inline limits](#inline-limits) |                                         |

Returns `201` with the service row. Service names are unique (case-insensitive) among live
services; a taken name is a `409`, on `PATCH` as well.

### `PATCH /api/services/:id` (`services:manage`)

Same fields as create, all optional. `name` and `type` cannot be blank; `description`,
`policyId`, `providerSecretId`, `allowedModels` and the inline limits are nullable. Returns the
updated service row; `404` for unknown or retired services.

### `DELETE /api/services/:id` (`services:manage`)

Retires the service (soft delete) and revokes its active tokens. `204`.

## Tokens

### `GET /api/tokens`

Tokens of active services, newest first, including service and policy names, inline limits and
`recopyable`. Never includes the token secret or its hash.

### `POST /api/tokens` (`tokens:manage`)

| Field           | Type                                | Notes                                          |
| --------------- | ----------------------------------- | ---------------------------------------------- |
| `name`          | string, required                    |                                                |
| `serviceId`     | uuid                                | omit to use the auto-created `Default` service |
| `scopes`        | string[]                            | default `[]`                                   |
| `allowedModels` | string[]                            | default `[]` (no extra restriction)            |
| `policyId`      | uuid                                | token-level preset                             |
| `expiresAt`     | ISO date string or epoch ms         |                                                |
| inline limits   | see [Inline limits](#inline-limits) |                                                |

Returns `201` with the token row plus `token`, the plaintext secret. **It is returned only once.**
An unknown or retired `serviceId` is a `400` with `field: "serviceId"`.

### `PATCH /api/tokens/:id` (`tokens:manage`)

Accepts `name`, `scopes`, `allowedModels`, `policyId` (nullable) and the inline limits. `scopes`
and `allowedModels` cannot be `null` (send `[]` instead). Returns the updated token row (without
secret columns). Revoked tokens are a `404`.

- `expiresAt`: ISO date or epoch ms, must be in the future; `null` removes the expiry.
- `recopyable`: only `false` is accepted. It deletes the stored secret for good, so the token can't
  be revealed again.

### `DELETE /api/tokens/:id` (`tokens:manage`)

Revokes the token. Unlike the other deletes this returns **`200`** with `{ "id", "revokedAt" }`.

## Provider keys

### `GET /api/providers`

Provider secrets grouped by provider, highest priority first: `id`, `provider`, `label`,
`baseUrl`, `priority`, `hint` (last 4 characters), timestamps. The secret itself is never
returned.

### `POST /api/providers` (`providers:manage`)

| Field      | Type             | Notes                                                         |
| ---------- | ---------------- | ------------------------------------------------------------- |
| `provider` | string, required | a known provider id (`openai`, `anthropic`, `azure`, …)       |
| `secret`   | string, required | the upstream API key                                          |
| `label`    | string           | tells several keys of one provider apart                      |
| `baseUrl`  | string           | required for providers with a per-deployment endpoint (Azure) |
| `priority` | integer          | default `0`; may be negative                                  |

Returns `201` with `{ "id", "provider" }`.

### `DELETE /api/providers/:id` (`providers:manage`)

`204`. Services pinned to the key fall back to the provider's default key.

## Policies

Reusable limit and access presets.

### `GET /api/policies`

All policies, newest first.

### `POST /api/policies` (`policies:manage`)

| Field                | Type                   | Default          |
| -------------------- | ---------------------- | ---------------- |
| `name`               | string, required       |                  |
| `allowedProviders`   | string[]               | `[]` (all)       |
| `allowedModels`      | string[]               | `[]` (all)       |
| `preferredProvider`  | string, nullable       | `null`           |
| `rateLimitPerMinute` | integer >= 0           | `0` (unlimited)  |
| `dailyBudgetUsd`     | number >= 0            | `0` (unlimited)  |
| `monthlyBudgetUsd`   | number >= 0            | `0` (unlimited)  |
| `cacheTtlSeconds`    | integer >= 0, nullable | `null` (inherit) |

Returns `201` with the policy row.

### `PATCH /api/policies/:id` (`policies:manage`)

Same fields, all optional. Only `preferredProvider` and `cacheTtlSeconds` accept
`null`. Returns the updated row.

### `DELETE /api/policies/:id` (`policies:manage`)

`204`. Services and tokens using the policy lose the reference.

## Pricing

Per-model USD prices per million tokens. Custom rows override the built-in defaults.

### `GET /api/pricing`

Effective prices for every model: the custom row where one exists, otherwise the default.

### `POST /api/pricing` (`pricing:manage`)

Creates the custom price for `model`, or replaces it if one exists.

| Field                   | Type                  | Notes                                      |
| ----------------------- | --------------------- | ------------------------------------------ |
| `model`                 | string, required      | model name or prefix, lower-cased on write |
| `provider`              | string, nullable      |                                            |
| `inputPerMtok`          | number >= 0, required |                                            |
| `outputPerMtok`         | number >= 0, required |                                            |
| `cacheReadPerMtok`      | number >= 0, nullable | omitted: derived from the input price      |
| `cacheWritePerMtok`     | number >= 0, nullable | omitted: derived from the input price      |
| `longInputPerMtok`      | number >= 0, nullable | omitted: single rate card                  |
| `longOutputPerMtok`     | number >= 0, nullable | long-context rate card                     |
| `longCacheReadPerMtok`  | number >= 0, nullable | long-context rate card                     |
| `longCacheWritePerMtok` | number >= 0, nullable | long-context rate card                     |

Returns `201` with the price row.

### `PATCH /api/pricing/:id` (`pricing:manage`)

Same fields except `model`, all optional. `inputPerMtok` and `outputPerMtok` cannot be `null`.
Only custom rows can be updated; default rows are a `404`.

### `DELETE /api/pricing/:id` (`pricing:manage`)

Deletes a custom row, reverting the model to its default price. `204`.

## Audit log

### `GET /api/audit?limit=N`

The most recent audit entries, newest first. `limit` defaults to `100`, maximum `500`.

## Inline limits

Services and tokens accept these override fields directly (all nullable; `null` = inherit):

| Field                | Type         |
| -------------------- | ------------ |
| `allowedProviders`   | string[]     |
| `preferredProvider`  | string       |
| `rateLimitPerMinute` | integer >= 0 |
| `dailyBudgetUsd`     | number >= 0  |
| `monthlyBudgetUsd`   | number >= 0  |
| `cacheTtlSeconds`    | integer >= 0 |

See `src/lib/server/effective-config.ts` for how the layers (instance, service policy, service,
token policy, token) combine.
