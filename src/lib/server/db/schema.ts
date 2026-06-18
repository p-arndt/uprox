import {
	pgTable,
	text,
	uuid,
	timestamp,
	integer,
	numeric,
	boolean,
	jsonb,
	uniqueIndex,
	index,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { user } from './auth.schema';

/**
 * A machine identity: an app, workload, or agent that authenticates to the
 * gateway with machine tokens. The whole instance is a single workspace, so
 * services are not scoped to any organization.
 */
export const service = pgTable('service', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	// free-form classification e.g. "agent", "workload", "app"
	type: text('type').notNull().default('app'),
	description: text('description'),
	policyId: uuid('policy_id').references(() => policy.id, { onDelete: 'set null' }),
	// Pinned upstream credential. When set, the gateway routes this service's
	// traffic for that secret's provider to this specific secret — e.g. one of
	// several Azure OpenAI resources. NULL = use the provider's default secret
	// (highest priority). The FK nulls out automatically if the secret is removed.
	providerSecretId: uuid('provider_secret_id').references((): AnyPgColumn => providerSecret.id, {
		onDelete: 'set null'
	}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	// Soft delete: services are retired, not removed, so historical audit-log
	// and usage rows keep resolving the service name (a hard delete would null
	// out auditLog.serviceId and surface "Deleted service"). A retired service
	// is hidden from listings and its tokens are revoked; see deleteService.
	deletedAt: timestamp('deleted_at')
});

/**
 * Opaque machine token. We NEVER store the raw token — only its sha256 hash,
 * exactly like a password. The plaintext is shown to the user exactly once.
 */
export const machineToken = pgTable(
	'machine_token',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		serviceId: uuid('service_id')
			.notNull()
			.references(() => service.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// non-secret prefix kept for display, e.g. "uprox_live_a1b2…"
		display: text('display').notNull(),
		hashedToken: text('hashed_token').notNull().unique(),
		// per-token scopes, e.g. ["chat", "models", "embeddings"]
		scopes: text('scopes')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		// Per-token model allowlist. NARROWS the effective policy's models — a model
		// must satisfy both this list and the policy to be reachable (intersection,
		// the token can only restrict, never widen). Empty = no extra restriction.
		// Same matching as policy.allowedModels (trailing "*" prefix glob).
		allowedModels: text('allowed_models')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		// Optional per-token policy. When set it REPLACES the service's policy for
		// requests made with this token (providers, models, rate limit, budget,
		// cache). NULL = inherit the service's policy. The FK nulls out if the
		// policy is deleted, reverting the token to its service policy.
		policyId: uuid('policy_id').references(() => policy.id, { onDelete: 'set null' }),
		lastUsedAt: timestamp('last_used_at'),
		expiresAt: timestamp('expires_at'),
		revokedAt: timestamp('revoked_at'),
		createdByUserId: uuid('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [index('machine_token_service_idx').on(t.serviceId)]
);

/**
 * Upstream provider API key (OpenAI, Anthropic, …), encrypted at rest with
 * AES-256-GCM. A provider may have several secrets — e.g. multiple Azure OpenAI
 * resources, each its own endpoint + key. A service can pin one of them via
 * `service.providerSecretId`; otherwise the gateway uses the provider's
 * highest-`priority` secret (see selectProviderSecret / loadProviderCreds).
 */
export const providerSecret = pgTable(
	'provider_secret',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// "openai" | "anthropic" | "azure" | …
		provider: text('provider').notNull(),
		// human-readable name to tell several secrets of one provider apart
		// (e.g. "Azure East US", "Azure Sweden"). Shown in the service picker.
		label: text('label'),
		// Upstream endpoint override. Required for providers whose base URL is
		// deployment-specific (Azure OpenAI's resource endpoint); NULL otherwise,
		// in which case the provider's static baseUrl is used.
		baseUrl: text('base_url'),
		// Default-selection priority among several secrets of the SAME provider.
		// When a service hasn't pinned a specific secret, the highest-priority one
		// for the resolved provider is used (oldest breaks ties). Default 0. See
		// selectProviderSecret. (Routing *between* providers for a shared model
		// namespace — OpenAI vs Azure — is the policy's preferredProvider, not this.)
		priority: integer('priority').notNull().default(0),
		// AES-256-GCM payload: iv:authTag:ciphertext (all base64)
		encryptedSecret: text('encrypted_secret').notNull(),
		// last 4 chars of the raw key, for display only
		hint: text('hint'),
		createdByUserId: uuid('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	// Non-unique: a provider may hold several secrets (e.g. many Azure resources).
	// The index keeps the by-provider lookup in loadProviderCreds fast.
	(t) => [index('provider_secret_provider_idx').on(t.provider)]
);

/**
 * Access policy: which providers/models a service is allowed to reach, plus
 * optional rate / spend limits.
 */
export const policy = pgTable('policy', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	// empty array means "all allowed"
	allowedProviders: text('allowed_providers')
		.array()
		.notNull()
		.default(sql`'{}'::text[]`),
	allowedModels: text('allowed_models')
		.array()
		.notNull()
		.default(sql`'{}'::text[]`),
	// When OpenAI and Azure both serve a shared model namespace, this provider
	// id wins for this policy's services. NULL = fall back to priority/order.
	preferredProvider: text('preferred_provider'),
	// requests per minute, 0 = unlimited
	rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(0),
	// spend ceilings in USD over a rolling window, summed per service. 0 = unlimited.
	dailyBudgetUsd: numeric('daily_budget_usd', { precision: 12, scale: 4 }).notNull().default('0'),
	monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 12, scale: 4 })
		.notNull()
		.default('0'),
	// exact-match cache TTL override, in seconds. NULL = inherit the instance
	// default; 0 = explicitly disabled; >0 = override the instance default.
	cacheTtlSeconds: integer('cache_ttl_seconds'),
	// per-policy request-tracing override. NULL = inherit the instance default
	// (settings.tracingEnabled); true/false force it on/off for this policy's
	// services. Tracing captures the request/response payloads of gateway calls
	// for the in-app trace viewer — see requestTrace.
	tracingEnabled: boolean('tracing_enabled'),
	createdAt: timestamp('created_at').defaultNow().notNull()
});

/**
 * Exact-match response cache. Keyed by a hash of (provider, path, normalized
 * request body) and shared instance-wide, so identical requests from any
 * service hit the same entry. Only successful, non-streaming responses are
 * cached, and only when the request's policy opts in via cacheTtlSeconds.
 */
export const responseCache = pgTable(
	'response_cache',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// sha256 of provider + path + canonical-JSON body
		cacheKey: text('cache_key').notNull(),
		provider: text('provider').notNull(),
		model: text('model'),
		statusCode: integer('status_code').notNull(),
		// the verbatim upstream JSON body to replay
		response: text('response').notNull(),
		// the cost the original (miss) response was billed at — replayed as the
		// exact amount saved on each subsequent hit
		costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
		// LLM tokens the original (miss) request consumed, replayed on each hit
		// as `savedInputTokens` / `savedOutputTokens` in the audit log so the
		// analytics can report how many tokens uprox's cache saved upstream.
		inputTokens: integer('input_tokens'),
		outputTokens: integer('output_tokens'),
		hits: integer('hits').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		expiresAt: timestamp('expires_at').notNull()
	},
	(t) => [
		uniqueIndex('response_cache_key_uidx').on(t.cacheKey),
		index('response_cache_expires_idx').on(t.expiresAt)
	]
);

/**
 * Instance-wide gateway settings — a single row (id = 1). Holds optimization
 * knobs that aren't access control (the default response-cache TTL, applied to
 * every service unless a policy overrides it), the member-permission toggles,
 * and budget-alert configuration.
 */
export const settings = pgTable('settings', {
	// fixed singleton id; there is only ever one settings row
	id: integer('id').primaryKey().default(1),
	// default exact-match cache TTL in seconds for the whole instance. 0 = off.
	cacheTtlSeconds: integer('cache_ttl_seconds').notNull().default(0),
	// member-permission toggles: when on, plain members (not just owners/admins)
	// may perform the corresponding action. Default off = members are read-only.
	membersCanManageTokens: boolean('members_can_manage_tokens').notNull().default(false),
	membersCanManageServices: boolean('members_can_manage_services').notNull().default(false),
	// budget alerts: when on, a service crossing the warn threshold (or its
	// ceiling) emails the instance's owners/admins (plus budgetAlertEmail if set).
	// Opt-in because it sends mail; threshold is a percentage of the ceiling.
	budgetAlertsEnabled: boolean('budget_alerts_enabled').notNull().default(false),
	budgetAlertThresholdPct: integer('budget_alert_threshold_pct').notNull().default(80),
	// optional extra recipient (e.g. a team distribution list)
	budgetAlertEmail: text('budget_alert_email'),
	// request tracing: when on, the gateway stores each request's prompt/response
	// payload for the in-app trace viewer (see requestTrace). Off by default
	// because payloads are sensitive and large; a policy can override per service.
	tracingEnabled: boolean('tracing_enabled').notNull().default(false),
	// how many days captured traces are retained before being pruned. Payloads
	// are bulky, so this is bounded rather than append-forever like the audit log.
	tracingRetentionDays: integer('tracing_retention_days').notNull().default(30),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

/**
 * Dedup ledger for budget alerts: one row per (service, window) records the
 * highest alert level already emailed for the *current* spend window. The
 * gateway evaluates alerts on every budgeted request, so without this a service
 * past its threshold would email on every call. We re-alert only when the window
 * rolls over (windowStart changes) or the level escalates (warn → over). See
 * budget-alerts.ts.
 */
export const budgetAlertState = pgTable(
	'budget_alert_state',
	{
		serviceId: uuid('service_id')
			.notNull()
			.references(() => service.id, { onDelete: 'cascade' }),
		// "daily" | "monthly"
		window: text('window').notNull(),
		// highest level emailed this window: "warn" | "over"
		lastLevel: text('last_level').notNull(),
		// start of the spend window the alert was sent for (UTC)
		windowStart: timestamp('window_start').notNull(),
		sentAt: timestamp('sent_at').defaultNow().notNull()
	},
	(t) => [uniqueIndex('budget_alert_state_service_window_uidx').on(t.serviceId, t.window)]
);

/**
 * Per-model token pricing used to estimate request cost for spend tracking and
 * budgets. Prices are in USD per 1,000,000 tokens.
 *
 * Two scopes share this table, distinguished by `isDefault`:
 *  - true  → platform defaults, seeded once from the built-in price list. Used
 *            for any model the instance hasn't given its own price.
 *  - false → an instance-specific price: either an override of a default model
 *            or an entirely new model the defaults don't cover.
 *
 * Cost lookup prefers a custom row and falls back to the matching default row,
 * so deleting a custom row simply reverts that model to the platform default.
 */
export const modelPrice = pgTable(
	'model_price',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// true = platform default; false = instance-specific override/addition.
		isDefault: boolean('is_default').notNull().default(true),
		// model name or longest-prefix key, matched like the legacy static map
		// (e.g. "gpt-4o", "claude-opus-4-7"). Lower-cased on write.
		model: text('model').notNull(),
		// provider id ("openai" | "anthropic" | "azure"), for display/grouping
		provider: text('provider'),
		// USD per 1,000,000 tokens
		inputPerMtok: numeric('input_per_mtok', { precision: 12, scale: 4 }).notNull(),
		outputPerMtok: numeric('output_per_mtok', { precision: 12, scale: 4 }).notNull(),
		// USD per 1,000,000 tokens for provider prompt-cache traffic, distinct from
		// the full input price. Both nullable: a NULL falls back to a multiplier of
		// the input price in the cost calc (read 0.1×, write 1.25×), so old default
		// rows and custom rows without explicit cache prices still price caching
		// sensibly. cacheWrite applies to Anthropic only (OpenAI/Azure charge nothing
		// to write a cache entry).
		cacheReadPerMtok: numeric('cache_read_per_mtok', { precision: 12, scale: 4 }),
		cacheWritePerMtok: numeric('cache_write_per_mtok', { precision: 12, scale: 4 }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		// one default per model, and one custom override per model. Split into two
		// partial indexes so a default and an override can coexist for one model.
		uniqueIndex('model_price_default_uidx')
			.on(t.model)
			.where(sql`${t.isDefault} = true`),
		uniqueIndex('model_price_custom_uidx')
			.on(t.model)
			.where(sql`${t.isDefault} = false`)
	]
);

/**
 * Append-only audit trail of every gateway request and admin action.
 */
export const auditLog = pgTable(
	'audit_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		serviceId: uuid('service_id').references(() => service.id, { onDelete: 'set null' }),
		tokenId: uuid('token_id').references(() => machineToken.id, { onDelete: 'set null' }),
		// "gateway.chat", "gateway.models", "token.create", "policy.deny", …
		action: text('action').notNull(),
		provider: text('provider'),
		model: text('model'),
		// "allow" | "deny" | "error" | "ok"
		status: text('status').notNull(),
		statusCode: integer('status_code'),
		costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
		// for cache hits: the exact amount saved (the cached entry's original cost)
		savedUsd: numeric('saved_usd', { precision: 12, scale: 6 }),
		// LLM tokens consumed by this request, as reported by the upstream provider.
		// NULL when the response carried no usage block (e.g. cache hits, errors,
		// non-JSON responses, or models that do not report token counts).
		inputTokens: integer('input_tokens'),
		outputTokens: integer('output_tokens'),
		// for cache hits: tokens the original (miss) request would have consumed,
		// replayed here so the analytics can show "tokens saved by cache" without
		// inflating the actual-consumption columns above.
		savedInputTokens: integer('saved_input_tokens'),
		savedOutputTokens: integer('saved_output_tokens'),
		// input tokens the *upstream provider* served from its own prompt cache
		// (OpenAI/Anthropic prompt caching) — distinct from uprox's exact-match
		// response cache. This is the cache *read* count. NULL when the response
		// reported no cache usage.
		providerCachedTokens: integer('provider_cached_tokens'),
		// input tokens written to the upstream provider's prompt cache this request
		// (Anthropic `cache_creation_input_tokens`). Billed at a premium over normal
		// input. NULL when the response reported no cache-write usage; always NULL
		// for OpenAI/Azure, which don't charge for cache writes.
		cacheWriteTokens: integer('cache_write_tokens'),
		latencyMs: integer('latency_ms'),
		ip: text('ip'),
		detail: text('detail'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [index('audit_log_created_idx').on(t.createdAt)]
);

/**
 * Captured request/response payloads for the in-app trace viewer — uprox's own
 * lightweight take on an LLM tracing tool (Phoenix-style). One row per traced
 * gateway request, paired 1:1 with its append-only {@link auditLog} row (which
 * holds the metadata: model, provider, status, tokens, cost, latency). The trace
 * carries only the heavy/sensitive parts — the prompt the caller sent and the
 * response uprox returned — so the lean audit path is untouched when tracing is
 * off.
 *
 * Written only when tracing is enabled for the request (instance setting, or a
 * policy override). Pruned by age (settings.tracingRetentionDays), unlike the
 * audit log, because payloads are bulky. Deleting the audit row cascades here.
 */
export const requestTrace = pgTable(
	'request_trace',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// the audit row this trace augments; cascade so a future audit prune (or a
		// service hard-delete that nulls audit FKs) never leaves an orphan trace.
		auditLogId: uuid('audit_log_id')
			.notNull()
			.references(() => auditLog.id, { onDelete: 'cascade' }),
		// denormalized from the audit row so the trace list can filter/scope by
		// service without a three-way join; nulls out if the service is removed.
		serviceId: uuid('service_id').references(() => service.id, { onDelete: 'set null' }),
		// caller-supplied session/correlation id (from the x-uprox-trace-id or
		// x-uprox-session-id request header). Groups the several gateway calls of one
		// logical run — e.g. a tool-use loop — into a single timeline in the viewer.
		// NULL when the caller sent no header. Free-form; not validated.
		traceGroupId: text('trace_group_id'),
		// the request body as the gateway received it (OpenAI or native Gemini shape),
		// verbatim JSON. NULL for requests with no JSON body (rare on traced routes).
		requestBody: text('request_body'),
		// the response body returned to the client: buffered JSON, or — for a streamed
		// request — the reassembled SSE wire text. NULL when no body was produced
		// (e.g. a policy denial returns only the error envelope, captured separately).
		responseBody: text('response_body'),
		// how to render responseBody: "json" (buffered) | "sse" (streamed). NULL when
		// there is no response body.
		responseFormat: text('response_format'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		uniqueIndex('request_trace_audit_uidx').on(t.auditLogId),
		index('request_trace_created_idx').on(t.createdAt),
		index('request_trace_group_idx').on(t.traceGroupId)
	]
);

/**
 * Spans ingested from client applications via the OTLP endpoint (POST
 * /v1/traces). Where {@link requestTrace} captures the calls uprox itself
 * proxies, this holds the app's *own* OpenTelemetry/OpenInference spans —
 * retriever, embedding, agent, LLM steps — so the trace viewer can render the
 * full nested tree the proxy can't observe on its own. Spans of one trace share
 * a `traceId`; `parentSpanId` builds the tree. Because uprox auto-groups its
 * proxy calls by the same W3C trace-id (see readTraceGroup), an app's spans and
 * uprox's captured calls line up under one id. Pruned by retention like traces.
 */
export const traceSpan = pgTable(
	'trace_span',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// 32-hex W3C trace id shared by every span of one trace
		traceId: text('trace_id').notNull(),
		// 16-hex span id, unique within a trace
		spanId: text('span_id').notNull(),
		// parent span within the same trace; NULL for a root span
		parentSpanId: text('parent_span_id'),
		name: text('name').notNull(),
		// OTLP span kind name (INTERNAL | SERVER | CLIENT | …); NULL if unset
		kind: text('kind'),
		// span start; OTLP nanos truncated to ms (enough to order a waterfall)
		startedAt: timestamp('started_at').notNull(),
		// span duration in milliseconds (end − start)
		durationMs: integer('duration_ms').notNull().default(0),
		// "ok" | "error" | "unset" from the OTLP status code
		status: text('status').notNull().default('unset'),
		// resource service.name, for display/scoping
		serviceName: text('service_name'),
		// the uprox service whose token ingested this span; nulls out if removed
		serviceId: uuid('service_id').references(() => service.id, { onDelete: 'set null' }),
		// flattened span attributes (OpenInference keys: llm.model_name, input.value,
		// output.value, llm.token_count.*, etc.) for the span-detail panel
		attributes: jsonb('attributes'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		uniqueIndex('trace_span_trace_span_uidx').on(t.traceId, t.spanId),
		index('trace_span_trace_idx').on(t.traceId),
		index('trace_span_created_idx').on(t.createdAt)
	]
);

export const serviceRelations = relations(service, ({ one, many }) => ({
	policy: one(policy, { fields: [service.policyId], references: [policy.id] }),
	tokens: many(machineToken)
}));

export const machineTokenRelations = relations(machineToken, ({ one }) => ({
	service: one(service, { fields: [machineToken.serviceId], references: [service.id] }),
	policy: one(policy, { fields: [machineToken.policyId], references: [policy.id] })
}));

export const policyRelations = relations(policy, ({ many }) => ({
	services: many(service),
	tokens: many(machineToken)
}));

export * from './auth.schema';
