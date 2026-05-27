import {
	pgTable,
	text,
	uuid,
	timestamp,
	integer,
	numeric,
	boolean,
	uniqueIndex,
	index
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { organization, user } from './auth.schema';

/**
 * A machine identity: an app, workload, or agent that belongs to an organization
 * and authenticates to the gateway with machine tokens.
 */
export const service = pgTable(
	'service',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// free-form classification e.g. "agent", "workload", "app"
		type: text('type').notNull().default('app'),
		description: text('description'),
		policyId: uuid('policy_id').references(() => policy.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		// Soft delete: services are retired, not removed, so historical audit-log
		// and usage rows keep resolving the service name (a hard delete would null
		// out auditLog.serviceId and surface "Deleted service"). A retired service
		// is hidden from listings and its tokens are revoked; see deleteService.
		deletedAt: timestamp('deleted_at')
	},
	(t) => [index('service_org_idx').on(t.organizationId)]
);

/**
 * Opaque machine token. We NEVER store the raw token — only its sha256 hash,
 * exactly like a password. The plaintext is shown to the user exactly once.
 */
export const machineToken = pgTable(
	'machine_token',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
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
		lastUsedAt: timestamp('last_used_at'),
		expiresAt: timestamp('expires_at'),
		revokedAt: timestamp('revoked_at'),
		createdByUserId: uuid('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('machine_token_org_idx').on(t.organizationId),
		index('machine_token_service_idx').on(t.serviceId)
	]
);

/**
 * Upstream provider API key (OpenAI, Anthropic, …), encrypted at rest with
 * AES-256-GCM. One secret per (organization, provider).
 */
export const providerSecret = pgTable(
	'provider_secret',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		// "openai" | "anthropic" | "azure" | …
		provider: text('provider').notNull(),
		label: text('label'),
		// Per-org upstream endpoint override. Required for providers whose base URL
		// is per-organization (Azure OpenAI's resource endpoint); NULL otherwise,
		// in which case the provider's static baseUrl is used.
		baseUrl: text('base_url'),
		// Routing priority among the org's providers that share a model namespace
		// (OpenAI vs Azure both serve "gpt-*"). Higher wins; ties fall back to a
		// fixed provider order. Default 0, so adding Azure doesn't displace an
		// existing OpenAI secret unless its priority is raised. See resolveProvider.
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
	(t) => [uniqueIndex('provider_secret_org_provider_uidx').on(t.organizationId, t.provider)]
);

/**
 * Access policy: which providers/models a service is allowed to reach, plus
 * optional rate / spend limits.
 */
export const policy = pgTable(
	'policy',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
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
		// exact-match cache TTL override, in seconds. NULL = inherit the org
		// default; 0 = explicitly disabled; >0 = override the org default.
		cacheTtlSeconds: integer('cache_ttl_seconds'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [index('policy_org_idx').on(t.organizationId)]
);

/**
 * Exact-match response cache. Keyed by a hash of (provider, path, normalized
 * request body); shared per organization so identical requests from any of an
 * org's services hit the same entry. Only successful, non-streaming responses
 * are cached, and only when the request's policy opts in via cacheTtlSeconds.
 */
export const responseCache = pgTable(
	'response_cache',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
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
		hits: integer('hits').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		expiresAt: timestamp('expires_at').notNull()
	},
	(t) => [
		uniqueIndex('response_cache_org_key_uidx').on(t.organizationId, t.cacheKey),
		index('response_cache_expires_idx').on(t.expiresAt)
	]
);

/**
 * Org-wide gateway settings (one row per organization). Holds optimization
 * knobs that aren't access control — currently the default response-cache TTL,
 * which applies to every service unless a policy overrides it. Kept in an
 * app-owned table (not on the better-auth `organization` table, which is
 * generated and would clobber hand-added columns on regeneration).
 */
export const orgSettings = pgTable('org_settings', {
	organizationId: uuid('organization_id')
		.primaryKey()
		.references(() => organization.id, { onDelete: 'cascade' }),
	// default exact-match cache TTL in seconds for the whole org. 0 = off.
	cacheTtlSeconds: integer('cache_ttl_seconds').notNull().default(0),
	// member-permission toggles: when on, plain members (not just owners/admins)
	// may perform the corresponding action. Default off = members are read-only.
	membersCanManageTokens: boolean('members_can_manage_tokens').notNull().default(false),
	membersCanManageServices: boolean('members_can_manage_services').notNull().default(false),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

/**
 * Per-model token pricing used to estimate request cost for spend tracking and
 * budgets. Prices are in USD per 1,000,000 tokens.
 *
 * Two scopes share this table, distinguished by `organizationId`:
 *  - NULL  → platform defaults, seeded once from the built-in price list. Every
 *            organization inherits these unless it defines its own row.
 *  - <org> → an organization's own price: either an override of a default model
 *            or an entirely new model the defaults don't cover.
 *
 * Cost lookup prefers an org's row and falls back to the matching default row,
 * so deleting an org row simply reverts that model to the platform default.
 */
export const modelPrice = pgTable(
	'model_price',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// NULL = platform default (shared by all orgs); set = org-specific price.
		organizationId: uuid('organization_id').references(() => organization.id, {
			onDelete: 'cascade'
		}),
		// model name or longest-prefix key, matched like the legacy static map
		// (e.g. "gpt-4o", "claude-opus-4-7"). Lower-cased on write.
		model: text('model').notNull(),
		// provider id ("openai" | "anthropic" | "azure"), for display/grouping
		provider: text('provider'),
		// USD per 1,000,000 tokens
		inputPerMtok: numeric('input_per_mtok', { precision: 12, scale: 4 }).notNull(),
		outputPerMtok: numeric('output_per_mtok', { precision: 12, scale: 4 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(t) => [
		// one default per model, and one override per (org, model). Split into two
		// partial indexes because Postgres treats NULL org ids as distinct.
		uniqueIndex('model_price_default_uidx')
			.on(t.model)
			.where(sql`${t.organizationId} is null`),
		uniqueIndex('model_price_org_uidx')
			.on(t.organizationId, t.model)
			.where(sql`${t.organizationId} is not null`),
		index('model_price_org_idx').on(t.organizationId)
	]
);

/**
 * Append-only audit trail of every gateway request and admin action.
 */
export const auditLog = pgTable(
	'audit_log',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
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
		// input tokens the *upstream provider* served from its own prompt cache
		// (OpenAI/Anthropic prompt caching) — distinct from uprox's exact-match
		// response cache. NULL when the response reported no cache usage.
		providerCachedTokens: integer('provider_cached_tokens'),
		latencyMs: integer('latency_ms'),
		ip: text('ip'),
		detail: text('detail'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		index('audit_log_org_idx').on(t.organizationId),
		index('audit_log_created_idx').on(t.createdAt)
	]
);

export const serviceRelations = relations(service, ({ one, many }) => ({
	organization: one(organization, {
		fields: [service.organizationId],
		references: [organization.id]
	}),
	policy: one(policy, { fields: [service.policyId], references: [policy.id] }),
	tokens: many(machineToken)
}));

export const machineTokenRelations = relations(machineToken, ({ one }) => ({
	service: one(service, { fields: [machineToken.serviceId], references: [service.id] }),
	organization: one(organization, {
		fields: [machineToken.organizationId],
		references: [organization.id]
	})
}));

export const policyRelations = relations(policy, ({ many }) => ({
	services: many(service)
}));

export * from './auth.schema';
