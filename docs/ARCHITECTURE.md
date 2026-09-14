# Architecture and conventions

How uprox is structured and the rules new code should follow.

The admin REST API under `/api` is documented in [`docs/API.md`](API.md).

## Layers

```
src/
  hooks.server.ts            auth, CSRF guard, gateway error shape, startup migrations
  routes/                    thin SvelteKit pages, form actions and endpoints
    app/**                   dashboard (session auth)
    api/**                   session-authenticated REST API
    v1/**, openai/**, v1beta/**  gateway surface (machine-token auth)
  lib/
    server/                  server-only modules, grouped by domain
      db/                    drizzle client + schema (never imported by client code)
      gateway/               request pipeline driven by endpoint descriptors
      adapters/              upstream provider adapters
      api/                   REST body parsers and error shapes for /api
      otlp/                  OTLP trace decoding
      usage-queries/         cost-analysis SQL, one module per query family
    features/<domain>/       domain logic, types and components (see below)
    components/              UI building blocks shared across features
      layout/                page-shell, page-header, detail-header, empty-state, stat-card
      form/                  field-label, select-field, entity-dialog, confirm-action, ...
      data/                  delta-pill, sparkline
      ui/                    vendored shadcn-svelte primitives (do not edit)
    state/                   shared rune state (table sorting)
    hooks/                   shared rune hooks
    *.ts                     pure, isomorphic helpers (format, permissions, nav, ...)
drizzle/                     generated SQL migrations + snapshots
tests/unit | tests/db | tests/e2e
```

## Rules

### Thin pages

`+page.server.ts`, `+layout.server.ts` and `+server.ts` do three things only:

1. authenticate and authorize (session or machine token),
2. parse and validate input (params, search params, form data, JSON body),
3. call a server module and shape the result for the page.

No SQL, no business rules, no multi-step orchestration in route files. If a load
function grows past a few calls, the orchestration belongs in a server module.

### Logic in pure, tested modules

Decisions (budget windows, policy evaluation, pricing, range resolution, usage
normalization, permission checks) live in plain `.ts` modules that take data in and
return data out. They do not touch `db`, `fetch` or `env` directly, so they can be
unit tested without mocks. I/O wrappers stay thin and call into them.

### Server modules by domain

- `src/lib/server/<domain>.ts` (or `src/lib/server/<domain>/`) per domain: services,
  tokens, providers, policies, pricing, budgets, usage, traces, members, settings.
- There is no catch-all barrel. Import each function from the module that defines it.
- The gateway is a request pipeline
  (authenticate -> resolve endpoint -> policy/budget/rate limit -> cache -> upstream
  adapter -> meter/audit/trace) driven by **endpoint descriptors**: one declarative
  entry per public endpoint (path, request kind, model extraction, streaming,
  metering). A new endpoint should be a descriptor plus, if needed, an adapter, not
  a copied route handler.

### Client code never value-imports server code

Anything that can reach the browser bundle (`src/lib/**` outside `server/`, `.svelte`
files, `+page.ts`, `+layout.ts`) may only use `import type` from `$lib/server/**`.
Shared runtime code (constants, formatters, permission checks) goes in `src/lib/*.ts`
or a feature folder. Server code must not import `$lib/components`.
Both rules are enforced by `no-restricted-imports` in `eslint.config.js`.

### Feature folders

Client-safe domain code lives in `src/lib/features/<domain>/`: pure modules and
shared types at the top level, the domain's Svelte components in `components/`.
Everything here is isomorphic, so server modules may import the pure modules (never
the components).

```
src/lib/features/
  usage/        range, group, url, meters, colors, cache-rate, chart-math, donut,
                headline, metric, efficiency, token-meters, types, meter-types,
                view.svelte.ts (URL-backed view state)
    components/ usage-workbench, usage-headline, usage-stacked-chart, usage-*, ...
  traces/       trace.ts (payload parsing), otel.ts (span tree)
    components/ trace-conversation, trace-metadata, trace-waterfall, raw-payload-tabs
  tokens/       tokens.ts
    components/ token-form, token-row, create-token-dialog, edit-token-dialog, secret-dialog
  providers/    providers.ts
    components/ provider-key-dialog, rotate-key-dialog, edit-meta-dialog, provider-secret-row
  pricing/      pricing.ts
    components/ price-row, price-cell, add-model-dialog
  policies/     inline-limits.ts, inline-limits-hints.ts
    components/ policy-form, inline-limits-fields, inline-limits-advanced
  budget/       budget.ts
    components/ budget-alert, budget-gauge
  auth/
    components/ auth-shell, oidc-sign-in-form
```

Tests for pure modules stay in `tests/unit/`.

Put new domain-specific code in the matching feature folder. A component used by a
single route (e.g. `src/routes/app/services/service-form.svelte`) stays colocated
with that route. `src/lib/components/` is only for building blocks used across
features.

### Vendored UI

`src/lib/components/ui/**` is generated by the shadcn-svelte CLI and gets
overwritten on update. **Never edit it.** Style primitives from the call site via
`class` props, or wrap them in a component in `src/lib/components/`.

### Language

Code, identifiers, comments, commit messages, log and error messages are English.
User-facing UI copy may be German (or any product language). Keep the identifiers
around it English.

### Size budgets

ESLint warns at 600 lines per file, 120 lines per function, cyclomatic complexity 20
and nesting depth 4. A warning means: split before adding more.

## Testing layers

| Layer | Location      | Runs with        | Use for                                                            |
| ----- | ------------- | ---------------- | ------------------------------------------------------------------ |
| Unit  | `tests/unit/` | `pnpm test:unit` | pure logic, adapters, parsers. No database, no network.            |
| DB    | `tests/db/`   | `pnpm test:db`   | real SQL: queries, aggregations, constraints, migrations           |
| E2E   | `tests/e2e/`  | `pnpm test:e2e`  | critical user flows against a production build and a real Postgres |

- **DB tests** run against [PGlite](https://pglite.dev) (Postgres in WASM, in-process).
  `tests/setup/db.ts` mocks `$lib/server/db` with a fresh PGlite database per test
  file and applies every migration from `drizzle/`. Seed with drizzle, call the real
  server function, assert on the result. No Docker needed.
- Prefer a DB test over hand-mocking `db` for any function whose correctness depends
  on SQL.
- **E2E** needs a running Postgres (`pnpm db:start`) and a Chromium install
  (`pnpm test:e2e:install`). It uses a dedicated `uprox_test` database.
- Coverage: `pnpm test:unit --run --coverage` (text + `coverage/lcov.info`).

## Database and analytics performance

`audit_log`, `request_trace` and `trace_span` grow without bound. Queries over them
must stay index-friendly:

- **Always bound `created_at`** with a lower (and usually upper) limit in the `WHERE`
  clause. Never scan the whole table for a dashboard widget.
- **Aggregate in SQL** (`count`, `sum`, `filter (where ...)`, `generate_series` for
  empty buckets). Do not fetch rows to sum them in JS.
- **Dedupe per page load**: if several widgets need the same aggregate, compute it
  once in the load function (or a shared server helper) and pass it down instead of
  re-querying.
- **Index new filter columns**: adding a column that is filtered or grouped on in
  analytics needs an index (composite with `created_at` where the query is also
  time-bounded) in the same migration.
- Bind timestamps as ISO strings cast with `::timestamp` in raw `db.execute`
  templates. `created_at` is `timestamp without time zone` holding UTC.

## Migrations

- Change `src/lib/server/db/schema.ts`, then `pnpm db:generate` and commit the
  generated files in `drizzle/`. CI fails if the schema and migrations drift.
- Migrations are applied automatically at server start (`init` in `hooks.server.ts`).

## CI

`.github/workflows/ci.yaml` runs on every push and pull request: type check, lint,
unit tests, DB tests, migration drift check, production build, and E2E against a
Postgres service container.
