import {
	pgTable,
	text,
	timestamp,
	integer,
	numeric,
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
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// free-form classification e.g. "agent", "workload", "app"
		type: text('type').notNull().default('app'),
		description: text('description'),
		policyId: text('policy_id').references(() => policy.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull()
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
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		serviceId: text('service_id')
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
		createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
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
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		// "openai" | "anthropic" | …
		provider: text('provider').notNull(),
		label: text('label'),
		// AES-256-GCM payload: iv:authTag:ciphertext (all base64)
		encryptedSecret: text('encrypted_secret').notNull(),
		// last 4 chars of the raw key, for display only
		hint: text('hint'),
		createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
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
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
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
		// requests per minute, 0 = unlimited
		rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(0),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [index('policy_org_idx').on(t.organizationId)]
);

/**
 * Append-only audit trail of every gateway request and admin action.
 */
export const auditLog = pgTable(
	'audit_log',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		serviceId: text('service_id').references(() => service.id, { onDelete: 'set null' }),
		tokenId: text('token_id').references(() => machineToken.id, { onDelete: 'set null' }),
		// "gateway.chat", "gateway.models", "token.create", "policy.deny", …
		action: text('action').notNull(),
		provider: text('provider'),
		model: text('model'),
		// "allow" | "deny" | "error" | "ok"
		status: text('status').notNull(),
		statusCode: integer('status_code'),
		costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
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
