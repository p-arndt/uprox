import {
	pgTable,
	text,
	uuid,
	timestamp,
	integer,
	numeric,
	boolean,
	uniqueIndex,
	index,
	primaryKey,
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
	// Optional reusable preset. Its limits/access are the lowest-priority layer in
	// the effective-config cascade (see effective-config.ts): the service's own
	// inline fields below override it field-by-field, and a token overrides both.
	policyId: uuid('policy_id').references(() => policy.id, { onDelete: 'set null' }),
	// ---- inline limits & access (NULL = inherit the preset / instance default) ----
	// These let you set limits directly on the service without authoring a preset.
	// Each is merged independently; see effective-config.ts for the exact cascade.
	// Empty (non-null) allowlist still means "allow all" — same as a preset's.
	allowedProviders: text('allowed_providers').array(),
	allowedModels: text('allowed_models').array(),
	preferredProvider: text('preferred_provider'),
	// requests/min; NULL = inherit, 0 = explicitly unlimited
	rateLimitPerMinute: integer('rate_limit_per_minute'),
	// USD spend ceilings summed across ALL of this service's tokens (the aggregate
	// ceiling). NULL = inherit, 0 = unlimited. Enforced alongside per-token budgets.
	dailyBudgetUsd: numeric('daily_budget_usd', { precision: 12, scale: 4 }),
	monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 12, scale: 4 }),
	// NULL = inherit, 0 = off, >0 = TTL seconds
	cacheTtlSeconds: integer('cache_ttl_seconds'),
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
		// Optional reversible copy of the raw token, AES-256-GCM encrypted (same
		// `iv.authTag.ciphertext` payload as provider secrets). Populated ONLY when
		// the token was issued as re-copyable, so operators can reveal the secret
		// again later instead of reissuing. NULL = secure default, the plaintext is
		// recoverable from nowhere (hash only). Trades the can't-leak guarantee for
		// convenience: DB + ENCRYPTION_KEY together expose these. Never used for
		// auth — resolveToken always matches on hashedToken.
		encryptedToken: text('encrypted_token'),
		// per-token scopes, e.g. ["chat", "models", "embeddings"]
		scopes: text('scopes')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		// Per-token model allowlist. NARROWS the effective access — a model must
		// satisfy every non-empty allowlist across all layers to be reachable
		// (intersection; a layer can only restrict, never widen). Empty = no
		// restriction from this layer. Trailing "*" is a prefix glob.
		allowedModels: text('allowed_models')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		// Optional reusable preset for this token. Lower priority than the token's
		// own inline fields below, higher than the service's. NULL = no preset.
		// The FK nulls out if the preset is deleted.
		policyId: uuid('policy_id').references(() => policy.id, { onDelete: 'set null' }),
		// ---- inline limits & access (NULL = inherit) ----
		// Highest-priority layer in the effective-config cascade: a value set here
		// overrides the token's preset, the service, and the service's preset.
		// See effective-config.ts.
		allowedProviders: text('allowed_providers').array(),
		preferredProvider: text('preferred_provider'),
		// requests/min; NULL = inherit, 0 = unlimited
		rateLimitPerMinute: integer('rate_limit_per_minute'),
		// Per-token USD spend ceilings (this token's personal cap). NULL = inherit,
		// 0 = unlimited. Enforced in ADDITION to the service's aggregate budget.
		dailyBudgetUsd: numeric('daily_budget_usd', { precision: 12, scale: 4 }),
		monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 12, scale: 4 }),
		// NULL = inherit, 0 = off, >0 = TTL seconds
		cacheTtlSeconds: integer('cache_ttl_seconds'),
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
	// default for the "allow re-copying" checkbox when issuing a new token. When on,
	// new tokens are stored re-copyable (encrypted at rest) unless the issuer opts
	// out per token; when off, new tokens are hash-only unless the issuer opts in.
	// Off by default — the secure hash-only behaviour stays the default. Only the
	// default; never forces existing or individual tokens. See machineToken.encryptedToken.
	tokensRecopyableDefault: boolean('tokens_recopyable_default').notNull().default(false),
	// Instance-wide spend ceilings, summed across EVERY service and token. The
	// top, broadest layer of budget enforcement (above the per-service aggregate
	// and per-token caps) — a request must stay within all that apply. NULL or 0
	// = unlimited. UTC daily/monthly windows, summed from the audit log like the
	// other budgets. See budget.ts ('instance' scope) and effective-config.ts.
	dailyBudgetUsd: numeric('daily_budget_usd', { precision: 12, scale: 4 }),
	monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 12, scale: 4 }),
	// budget alerts: when on, a service crossing the warn threshold (or its
	// ceiling) emails the instance's owners/admins (plus budgetAlertEmail if set).
	// Opt-in because it sends mail; threshold is a percentage of the ceiling.
	budgetAlertsEnabled: boolean('budget_alerts_enabled').notNull().default(false),
	budgetAlertThresholdPct: integer('budget_alert_threshold_pct').notNull().default(80),
	// optional extra recipient (e.g. a team distribution list)
	budgetAlertEmail: text('budget_alert_email'),
	// when off, SSO sign-in no longer auto-provisions unknown users: only existing
	// members, invited addresses and the very first (bootstrap) account get in.
	// On by default, matching the original auto-provisioning behaviour.
	ssoSignupEnabled: boolean('sso_signup_enabled').notNull().default(true),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

/**
 * Dedup ledger for budget alerts: one row per (scope, scopeId, window) records
 * the highest alert level already emailed for the *current* spend window. The
 * gateway evaluates alerts on every budgeted request, so without this a budget
 * past its threshold would email on every call. We re-alert only when the window
 * rolls over (windowStart changes) or the level escalates (warn → over). See
 * budget-alerts.ts.
 */
export const budgetAlertState = pgTable(
	'budget_alert_state',
	{
		// which budget scope this row tracks, mirroring budget.ts BudgetScope:
		// 'service' | 'instance' (per-token alerts could be added the same way).
		scope: text('scope').notNull().default('service'),
		// the scope's id: a service uuid (as text) for 'service', or the literal
		// 'instance' for the instance-wide ceiling. Plain text (not a service FK)
		// so one ledger covers both — the instance scope has no service row to
		// reference. Service rows are soft-deleted, so no cascade is needed.
		scopeId: text('scope_id').notNull(),
		// "daily" | "monthly"
		window: text('window').notNull(),
		// highest level emailed this window: "warn" | "over"
		lastLevel: text('last_level').notNull(),
		// start of the spend window the alert was sent for (UTC)
		windowStart: timestamp('window_start').notNull(),
		sentAt: timestamp('sent_at').defaultNow().notNull()
	},
	// One ledger row per (scope, scopeId, window): the primary key is also the
	// upsert conflict target in budget-alerts.ts.
	(t) => [primaryKey({ columns: [t.scope, t.scopeId, t.window] })]
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
		// the input price in the cost calc (read 0.1×, write 1.25×), so custom rows
		// without explicit cache prices still price caching sensibly. Only Anthropic
		// and OpenAI's GPT-5.6 family and later *surcharge* cache writes (1.25×);
		// elsewhere a written token is billed as plain input, which those default
		// rows encode by setting cache_write_per_mtok = input_per_mtok.
		cacheReadPerMtok: numeric('cache_read_per_mtok', { precision: 12, scale: 4 }),
		cacheWritePerMtok: numeric('cache_write_per_mtok', { precision: 12, scale: 4 }),
		// Long-context rate card, billed once a request's prompt reaches
		// LONG_CONTEXT_MIN_PROMPT_TOKENS (see providers.ts). All nullable:
		// long_input_per_mtok being NULL means the model has a single rate card and
		// every request bills at the standard columns above.
		longInputPerMtok: numeric('long_input_per_mtok', { precision: 12, scale: 4 }),
		longOutputPerMtok: numeric('long_output_per_mtok', { precision: 12, scale: 4 }),
		longCacheReadPerMtok: numeric('long_cache_read_per_mtok', { precision: 12, scale: 4 }),
		longCacheWritePerMtok: numeric('long_cache_write_per_mtok', { precision: 12, scale: 4 }),
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
		// (Anthropic `cache_creation_input_tokens`, OpenAI GPT-5.6+
		// `prompt_tokens_details.cache_write_tokens`). Billed at a premium over
		// normal input. NULL when the response reported no cache-write usage —
		// which is every OpenAI model below GPT-5.6, none of which surcharge writes.
		cacheWriteTokens: integer('cache_write_tokens'),
		// which rate card this request billed against: "standard" | "long". A model
		// with a long-context card (model_price.long_input_per_mtok) bills its whole
		// request at 2×/1.5× once the prompt reaches LONG_CONTEXT_MIN_PROMPT_TOKENS,
		// so the same token count can cost twice as much depending on this. NULL
		// when nothing was priced (a denial, an error, an unpriced model).
		contextTier: text('context_tier'),
		latencyMs: integer('latency_ms'),
		ip: text('ip'),
		detail: text('detail'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('audit_log_created_idx').on(t.createdAt),
		// Usage analytics only read gateway traffic inside a time window. The
		// migration adds an INCLUDE list of the aggregated columns (drizzle cannot
		// express INCLUDE) so those scans can be answered from the index alone.
		index('audit_log_gateway_created_idx')
			.on(t.createdAt)
			.where(sql`${t.action} like 'gateway.%'`),
		// budget enforcement sums spend per service / per token since a day or month start
		index('audit_log_service_created_idx').on(t.serviceId, t.createdAt),
		index('audit_log_token_created_idx').on(t.tokenId, t.createdAt)
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
