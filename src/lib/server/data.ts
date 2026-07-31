import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	service,
	machineToken,
	providerSecret,
	policy,
	auditLog,
	requestTrace,
	traceSpan,
	settings,
	modelPrice
} from '$lib/server/db/schema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { issueToken } from '$lib/server/tokens';
import { audit } from '$lib/server/audit';
import type { BudgetStatus } from '$lib/budget';
import { cacheRate } from '$lib/cache-rate';
import type { MetaFilter } from '$lib/trace';
import {
	resolveSeriesBucket,
	type BucketChoice,
	type ResolvedRange,
	type SeriesBucket
} from '$lib/usage-range';
import {
	NULL_VALUE,
	OTHERS_KEY,
	type UsageDimension,
	type UsageFilter,
	type UsageFilterOption,
	type UsageFilterOptions
} from '$lib/usage-group';

/**
 * Inline limit & access overrides settable directly on a service or token —
 * the higher-priority layers of the effective-config cascade (see
 * effective-config.ts). Every field is optional and nullable: omit to leave
 * unchanged, pass `null` to clear the override (revert to inherit).
 */
export interface InlineConfigInput {
	allowedProviders?: string[] | null;
	allowedModels?: string[] | null;
	preferredProvider?: string | null;
	rateLimitPerMinute?: number | null;
	dailyBudgetUsd?: number | null;
	monthlyBudgetUsd?: number | null;
	cacheTtlSeconds?: number | null;
	tracingEnabled?: boolean | null;
}

/**
 * Map the inline-config fields present in `input` to a drizzle set/values object,
 * coercing the numeric budget columns to the string form drizzle/pg expects.
 * Only keys actually present are written, so it composes with PATCH semantics.
 */
function inlineConfigColumns(input: InlineConfigInput): Record<string, unknown> {
	const set: Record<string, unknown> = {};
	if (input.allowedProviders !== undefined) set.allowedProviders = input.allowedProviders;
	if (input.allowedModels !== undefined) set.allowedModels = input.allowedModels;
	if (input.preferredProvider !== undefined) set.preferredProvider = input.preferredProvider;
	if (input.rateLimitPerMinute !== undefined) set.rateLimitPerMinute = input.rateLimitPerMinute;
	if (input.dailyBudgetUsd !== undefined) {
		set.dailyBudgetUsd = input.dailyBudgetUsd === null ? null : String(input.dailyBudgetUsd);
	}
	if (input.monthlyBudgetUsd !== undefined) {
		set.monthlyBudgetUsd = input.monthlyBudgetUsd === null ? null : String(input.monthlyBudgetUsd);
	}
	if (input.cacheTtlSeconds !== undefined) set.cacheTtlSeconds = input.cacheTtlSeconds;
	if (input.tracingEnabled !== undefined) set.tracingEnabled = input.tracingEnabled;
	return set;
}

/* ----------------------------------- services ----------------------------------- */

/**
 * The name of the auto-provisioned catch-all service. Tokens created without an
 * explicit service land here, so a user can start issuing tokens before they
 * think about organising anything. It's an ordinary service in every other
 * respect — editable, soft-deletable, can carry its own limits/budget.
 */
export const DEFAULT_SERVICE_NAME = 'Default';

/**
 * Return the catch-all "Default" service, creating it on first use. Matches by
 * name among non-deleted services so a manually-created "Default" is reused
 * rather than duplicated. Not transactionally locked: a rare concurrent first
 * call could create two rows, which is harmless (both are valid services) and
 * self-heals on the next lookup picking the oldest.
 */
export async function getOrCreateDefaultService() {
	const [existing] = await db
		.select()
		.from(service)
		.where(and(eq(service.name, DEFAULT_SERVICE_NAME), isNull(service.deletedAt)))
		.orderBy(service.createdAt)
		.limit(1);
	if (existing) return existing;
	return createService({
		name: DEFAULT_SERVICE_NAME,
		description: 'Catch-all project for tokens created without one.'
	});
}

export function listServices() {
	return db
		.select()
		.from(service)
		.where(isNull(service.deletedAt))
		.orderBy(desc(service.createdAt));
}

export async function createService(
	input: {
		name: string;
		type?: string;
		description?: string;
		policyId?: string | null;
		providerSecretId?: string | null;
	} & InlineConfigInput
) {
	const [row] = await db
		.insert(service)
		.values({
			name: input.name,
			type: input.type || 'app',
			description: input.description || null,
			policyId: input.policyId || null,
			providerSecretId: input.providerSecretId || null,
			...inlineConfigColumns(input)
		})
		.returning();
	return row;
}

export async function updateService(
	id: string,
	patch: {
		name?: string;
		type?: string;
		description?: string | null;
		policyId?: string | null;
		providerSecretId?: string | null;
	} & InlineConfigInput
) {
	const {
		allowedProviders,
		allowedModels,
		preferredProvider,
		rateLimitPerMinute,
		dailyBudgetUsd,
		monthlyBudgetUsd,
		cacheTtlSeconds,
		tracingEnabled,
		...base
	} = patch;
	const set = {
		...base,
		...inlineConfigColumns({
			allowedProviders,
			allowedModels,
			preferredProvider,
			rateLimitPerMinute,
			dailyBudgetUsd,
			monthlyBudgetUsd,
			cacheTtlSeconds,
			tracingEnabled
		})
	};
	const [row] = await db
		.update(service)
		.set(set)
		.where(and(eq(service.id, id), isNull(service.deletedAt)))
		.returning();
	return row ?? null;
}

/**
 * Retire a service (soft delete). We stamp `deletedAt` rather than removing the
 * row so historical audit-log / usage rows keep resolving its name, and revoke
 * its still-active tokens in the same transaction so the retired service can no
 * longer authenticate — matching the old hard-delete-cascade behaviour where the
 * tokens disappeared. Already-deleted services are left untouched.
 */
export async function deleteService(id: string) {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.update(service)
			.set({ deletedAt: new Date() })
			.where(and(eq(service.id, id), isNull(service.deletedAt)))
			.returning({ id: service.id });
		if (!row) return;
		await tx
			.update(machineToken)
			.set({ revokedAt: new Date() })
			.where(and(eq(machineToken.serviceId, id), isNull(machineToken.revokedAt)));
	});
}

/** A single non-deleted service by id, or null. Powers the service detail page. */
export async function getService(id: string) {
	const [row] = await db
		.select()
		.from(service)
		.where(and(eq(service.id, id), isNull(service.deletedAt)))
		.limit(1);
	return row ?? null;
}

/* ------------------------------------ tokens ------------------------------------ */

/**
 * A single machine token by id with its service and (own) policy names, or null.
 * Powers the token detail page. Revoked tokens — and tokens whose service was
 * since soft-deleted — are still returned so historical usage stays attributable
 * (the page links here straight from the usage breakdowns).
 */
export async function getToken(id: string) {
	const [row] = await db
		.select({
			id: machineToken.id,
			name: machineToken.name,
			display: machineToken.display,
			scopes: machineToken.scopes,
			serviceId: machineToken.serviceId,
			serviceName: service.name,
			// the token's own policy (overrides the service policy when set)
			policyId: machineToken.policyId,
			policyName: policy.name,
			// true when the raw token can be revealed again (see machineToken.encryptedToken)
			recopyable: sql<boolean>`${machineToken.encryptedToken} is not null`,
			lastUsedAt: machineToken.lastUsedAt,
			expiresAt: machineToken.expiresAt,
			revokedAt: machineToken.revokedAt,
			createdAt: machineToken.createdAt
		})
		.from(machineToken)
		.innerJoin(service, eq(service.id, machineToken.serviceId))
		.leftJoin(policy, eq(policy.id, machineToken.policyId))
		.where(eq(machineToken.id, id))
		.limit(1);
	return row ?? null;
}

export function listTokens() {
	return (
		db
			.select({
				id: machineToken.id,
				name: machineToken.name,
				display: machineToken.display,
				scopes: machineToken.scopes,
				allowedModels: machineToken.allowedModels,
				serviceId: machineToken.serviceId,
				serviceName: service.name,
				// the token's optional preset
				policyId: machineToken.policyId,
				policyName: policy.name,
				// inline overrides, for the edit form's prefill
				allowedProviders: machineToken.allowedProviders,
				preferredProvider: machineToken.preferredProvider,
				rateLimitPerMinute: machineToken.rateLimitPerMinute,
				dailyBudgetUsd: machineToken.dailyBudgetUsd,
				monthlyBudgetUsd: machineToken.monthlyBudgetUsd,
				cacheTtlSeconds: machineToken.cacheTtlSeconds,
				tracingEnabled: machineToken.tracingEnabled,
				// true when the raw token was kept (encrypted) and can be revealed again;
				// the ciphertext itself is never sent to the client
				recopyable: sql<boolean>`${machineToken.encryptedToken} is not null`,
				lastUsedAt: machineToken.lastUsedAt,
				expiresAt: machineToken.expiresAt,
				revokedAt: machineToken.revokedAt,
				createdAt: machineToken.createdAt
			})
			.from(machineToken)
			.innerJoin(service, eq(service.id, machineToken.serviceId))
			.leftJoin(policy, eq(policy.id, machineToken.policyId))
			// hide tokens belonging to retired (soft-deleted) services
			.where(isNull(service.deletedAt))
			.orderBy(desc(machineToken.createdAt))
	);
}

/**
 * Create a machine token. Returns the row plus the one-time plaintext secret
 * which is NOT stored anywhere — surface it to the user immediately.
 */
export async function createToken(
	userId: string,
	input: {
		// optional: when omitted, the token lands in the auto-provisioned Default
		// service so tokens can be issued before any service is set up
		serviceId?: string | null;
		name: string;
		scopes?: string[];
		// per-token model allowlist (narrows access); empty = no extra restriction
		allowedModels?: string[];
		// optional reusable preset attached to this token; null = none
		policyId?: string | null;
		expiresAt?: Date | null;
		// when true, also store the raw token encrypted so it can be revealed again
		// later (weaker than hash-only — see machineToken.encryptedToken). Default off.
		recopyable?: boolean;
	} & Omit<InlineConfigInput, 'allowedModels'>
) {
	// resolve the target service: the one given (must exist and be active), or the
	// auto-provisioned Default when none was specified
	const svc = input.serviceId
		? (
				await db
					.select()
					.from(service)
					.where(and(eq(service.id, input.serviceId), isNull(service.deletedAt)))
					.limit(1)
			)[0]
		: await getOrCreateDefaultService();
	if (!svc) throw new Error('Service not found');

	const issued = issueToken();
	const [row] = await db
		.insert(machineToken)
		.values({
			serviceId: svc.id,
			name: input.name,
			display: issued.display,
			hashedToken: issued.hashedToken,
			// only persisted when the issuer opted into re-copying
			encryptedToken: input.recopyable ? encrypt(issued.plaintext) : null,
			scopes: input.scopes ?? [],
			allowedModels: input.allowedModels ?? [],
			policyId: input.policyId ?? null,
			expiresAt: input.expiresAt ?? null,
			createdByUserId: userId,
			...inlineConfigColumns({
				allowedProviders: input.allowedProviders,
				preferredProvider: input.preferredProvider,
				rateLimitPerMinute: input.rateLimitPerMinute,
				dailyBudgetUsd: input.dailyBudgetUsd,
				monthlyBudgetUsd: input.monthlyBudgetUsd,
				cacheTtlSeconds: input.cacheTtlSeconds,
				tracingEnabled: input.tracingEnabled
			})
		})
		.returning();

	await audit({
		action: 'token.create',
		status: 'ok',
		serviceId: svc.id,
		tokenId: row.id,
		detail: input.name
	});

	return { token: row, plaintext: issued.plaintext };
}

/**
 * Re-reveal the raw secret of a re-copyable token. Only works for tokens issued
 * with `recopyable` (their `encryptedToken` is set); returns null otherwise — a
 * hash-only token's plaintext is genuinely unrecoverable. Each reveal is audited
 * so re-copies stay traceable. Revoked tokens can still be revealed (the row is
 * dead for auth, but an operator may need the old value).
 */
export async function revealToken(id: string): Promise<{ name: string; plaintext: string } | null> {
	const [row] = await db
		.select({
			id: machineToken.id,
			name: machineToken.name,
			serviceId: machineToken.serviceId,
			encryptedToken: machineToken.encryptedToken
		})
		.from(machineToken)
		.where(eq(machineToken.id, id))
		.limit(1);
	if (!row?.encryptedToken) return null;

	const plaintext = decrypt(row.encryptedToken);
	await audit({
		action: 'token.reveal',
		status: 'ok',
		serviceId: row.serviceId,
		tokenId: row.id,
		detail: row.name
	});
	return { name: row.name, plaintext };
}

/**
 * Edit a live token in place. Tokens are long-lived and their secret can't be
 * regenerated, so the access controls (scopes, model allowlist, policy) and the
 * display name are editable without reissuing. Only the fields present in
 * `patch` are written. Revoked tokens are left untouched.
 */
export async function updateToken(
	id: string,
	patch: {
		name?: string;
		// reassign the token to another service (e.g. move it out of Default once
		// the user organises their tokens into real services)
		serviceId?: string;
		scopes?: string[];
		allowedModels?: string[];
		policyId?: string | null;
	} & Omit<InlineConfigInput, 'allowedModels'>
) {
	const set: Partial<typeof machineToken.$inferInsert> = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.serviceId !== undefined) set.serviceId = patch.serviceId;
	if (patch.scopes !== undefined) set.scopes = patch.scopes;
	if (patch.allowedModels !== undefined) set.allowedModels = patch.allowedModels;
	if (patch.policyId !== undefined) set.policyId = patch.policyId;
	Object.assign(
		set,
		inlineConfigColumns({
			allowedProviders: patch.allowedProviders,
			preferredProvider: patch.preferredProvider,
			rateLimitPerMinute: patch.rateLimitPerMinute,
			dailyBudgetUsd: patch.dailyBudgetUsd,
			monthlyBudgetUsd: patch.monthlyBudgetUsd,
			cacheTtlSeconds: patch.cacheTtlSeconds,
			tracingEnabled: patch.tracingEnabled
		})
	);
	if (Object.keys(set).length === 0) return null;

	const [row] = await db
		.update(machineToken)
		.set(set)
		.where(and(eq(machineToken.id, id), isNull(machineToken.revokedAt)))
		.returning();
	if (row) {
		await audit({
			action: 'token.update',
			status: 'ok',
			serviceId: row.serviceId,
			tokenId: row.id,
			detail: row.name
		});
	}
	return row ?? null;
}

export async function revokeToken(id: string) {
	const [row] = await db
		.update(machineToken)
		.set({ revokedAt: new Date() })
		.where(eq(machineToken.id, id))
		.returning();
	if (row) {
		await audit({
			action: 'token.revoke',
			status: 'ok',
			serviceId: row.serviceId,
			tokenId: row.id,
			detail: row.name
		});
	}
	return row ?? null;
}

// Permanently remove a token row. Unlike revokeToken this is irreversible —
// the audit_log.token_id FK is ON DELETE SET NULL, so history survives but loses
// the token link. The audit record we write here therefore omits tokenId (the row
// is already gone) and keeps the name in detail for traceability.
export async function deleteToken(id: string) {
	const [row] = await db.delete(machineToken).where(eq(machineToken.id, id)).returning();
	if (row) {
		await audit({
			action: 'token.delete',
			status: 'ok',
			serviceId: row.serviceId,
			detail: row.name
		});
	}
	return row ?? null;
}

/* ------------------------------- provider secrets ------------------------------- */

export function listProviderSecrets() {
	return (
		db
			.select({
				id: providerSecret.id,
				provider: providerSecret.provider,
				label: providerSecret.label,
				baseUrl: providerSecret.baseUrl,
				priority: providerSecret.priority,
				hint: providerSecret.hint,
				createdAt: providerSecret.createdAt,
				updatedAt: providerSecret.updatedAt
			})
			.from(providerSecret)
			// group a provider's secrets together, highest priority first
			.orderBy(providerSecret.provider, desc(providerSecret.priority), providerSecret.createdAt)
	);
}

/**
 * Add a provider secret. A provider may hold several (e.g. one per Azure OpenAI
 * resource), so this always inserts a new row — services pick among them via
 * their pinned secret, and the default is the highest-priority one.
 */
export async function createProviderSecret(
	userId: string,
	input: { provider: string; secret: string; label?: string; baseUrl?: string; priority?: number }
) {
	const hint = input.secret.slice(-4);
	const baseUrl = input.baseUrl?.trim() || null;
	const [row] = await db
		.insert(providerSecret)
		.values({
			provider: input.provider,
			label: input.label || null,
			baseUrl,
			priority: input.priority ?? 0,
			encryptedSecret: encrypt(input.secret),
			hint,
			createdByUserId: userId
		})
		.returning({ id: providerSecret.id, provider: providerSecret.provider });

	await audit({
		action: 'provider.create',
		status: 'ok',
		provider: input.provider,
		detail: input.label || input.provider
	});
	return row;
}

/**
 * Update a provider secret in place. Only the fields present in `input` are
 * written, so the label/endpoint/priority can be edited independently of
 * rotating the key (pass `secret` to rotate; the hint follows it). A defined but
 * empty `secret` clears the credential — used by optional-auth providers (Ollama)
 * to drop basic auth; an omitted `secret` leaves the stored key untouched.
 */
export async function updateProviderSecret(
	id: string,
	input: { label?: string | null; baseUrl?: string | null; priority?: number; secret?: string }
) {
	const set: Partial<typeof providerSecret.$inferInsert> = { updatedAt: new Date() };
	if (input.label !== undefined) set.label = input.label || null;
	if (input.baseUrl !== undefined) set.baseUrl = input.baseUrl?.trim() || null;
	if (input.priority !== undefined) set.priority = input.priority;
	const rotating = input.secret !== undefined;
	if (rotating) {
		set.encryptedSecret = encrypt(input.secret!);
		set.hint = input.secret!.slice(-4);
	}
	const [row] = await db
		.update(providerSecret)
		.set(set)
		.where(eq(providerSecret.id, id))
		.returning({ id: providerSecret.id, provider: providerSecret.provider });
	if (row) {
		await audit({
			action: rotating ? 'provider.rotate' : 'provider.update',
			status: 'ok',
			provider: row.provider,
			detail: row.provider
		});
	}
	return row ?? null;
}

export async function deleteProviderSecret(id: string) {
	await db.delete(providerSecret).where(eq(providerSecret.id, id));
}

/* ----------------------------------- policies ----------------------------------- */

export function listPolicies() {
	return db.select().from(policy).orderBy(desc(policy.createdAt));
}

export async function createPolicy(input: {
	name: string;
	allowedProviders?: string[];
	allowedModels?: string[];
	// "openai" | "azure" | null — preferred backend for the shared model namespace
	preferredProvider?: string | null;
	rateLimitPerMinute?: number;
	dailyBudgetUsd?: number;
	monthlyBudgetUsd?: number;
	// null = inherit instance default, 0 = off, >0 = override
	cacheTtlSeconds?: number | null;
	// null = inherit instance default; true/false force tracing on/off
	tracingEnabled?: boolean | null;
}) {
	const [row] = await db
		.insert(policy)
		.values({
			name: input.name,
			allowedProviders: input.allowedProviders ?? [],
			allowedModels: input.allowedModels ?? [],
			preferredProvider: input.preferredProvider ?? null,
			rateLimitPerMinute: input.rateLimitPerMinute ?? 0,
			dailyBudgetUsd: String(input.dailyBudgetUsd ?? 0),
			monthlyBudgetUsd: String(input.monthlyBudgetUsd ?? 0),
			cacheTtlSeconds: input.cacheTtlSeconds ?? null,
			tracingEnabled: input.tracingEnabled ?? null
		})
		.returning();
	return row;
}

export async function updatePolicy(
	id: string,
	patch: {
		name?: string;
		allowedProviders?: string[];
		allowedModels?: string[];
		preferredProvider?: string | null;
		rateLimitPerMinute?: number;
		dailyBudgetUsd?: number;
		monthlyBudgetUsd?: number;
		cacheTtlSeconds?: number | null;
		tracingEnabled?: boolean | null;
	}
) {
	// numeric columns round-trip as strings in drizzle/pg
	const { dailyBudgetUsd, monthlyBudgetUsd, ...rest } = patch;
	const [row] = await db
		.update(policy)
		.set({
			...rest,
			...(dailyBudgetUsd !== undefined ? { dailyBudgetUsd: String(dailyBudgetUsd) } : {}),
			...(monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: String(monthlyBudgetUsd) } : {})
		})
		.where(eq(policy.id, id))
		.returning();
	return row ?? null;
}

export async function deletePolicy(id: string) {
	await db.delete(policy).where(eq(policy.id, id));
}

/* -------------------------------- instance settings ---------------------------------- */

export interface Settings {
	cacheTtlSeconds: number;
	membersCanManageTokens: boolean;
	membersCanManageServices: boolean;
	tokensRecopyableDefault: boolean;
	// instance-wide spend ceilings across all services/tokens; null = unlimited
	dailyBudgetUsd: number | null;
	monthlyBudgetUsd: number | null;
	budgetAlertsEnabled: boolean;
	budgetAlertThresholdPct: number;
	budgetAlertEmail: string | null;
	tracingEnabled: boolean;
	tracingRetentionDays: number;
}

/** Read instance settings, falling back to defaults when no row exists yet. */
export async function getSettings(): Promise<Settings> {
	const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
	return {
		cacheTtlSeconds: row?.cacheTtlSeconds ?? 0,
		membersCanManageTokens: row?.membersCanManageTokens ?? false,
		membersCanManageServices: row?.membersCanManageServices ?? false,
		tokensRecopyableDefault: row?.tokensRecopyableDefault ?? false,
		dailyBudgetUsd: row?.dailyBudgetUsd != null ? Number(row.dailyBudgetUsd) : null,
		monthlyBudgetUsd: row?.monthlyBudgetUsd != null ? Number(row.monthlyBudgetUsd) : null,
		budgetAlertsEnabled: row?.budgetAlertsEnabled ?? false,
		budgetAlertThresholdPct: row?.budgetAlertThresholdPct ?? 80,
		budgetAlertEmail: row?.budgetAlertEmail ?? null,
		tracingEnabled: row?.tracingEnabled ?? false,
		tracingRetentionDays: row?.tracingRetentionDays ?? 30
	};
}

/**
 * Upsert instance gateway settings. Only the fields present in `input` are
 * written, so callers can update the cache TTL and the member-permission
 * toggles independently.
 */
export async function updateSettings(input: Partial<Settings>) {
	const set: Partial<typeof settings.$inferInsert> = {};
	if (input.cacheTtlSeconds !== undefined) {
		set.cacheTtlSeconds = Math.max(0, Math.floor(input.cacheTtlSeconds) || 0);
	}
	if (input.membersCanManageTokens !== undefined) {
		set.membersCanManageTokens = input.membersCanManageTokens;
	}
	if (input.membersCanManageServices !== undefined) {
		set.membersCanManageServices = input.membersCanManageServices;
	}
	if (input.tokensRecopyableDefault !== undefined) {
		set.tokensRecopyableDefault = input.tokensRecopyableDefault;
	}
	// budgets: null or a non-positive number clears the ceiling (unlimited)
	if (input.dailyBudgetUsd !== undefined) {
		set.dailyBudgetUsd =
			input.dailyBudgetUsd && input.dailyBudgetUsd > 0 ? String(input.dailyBudgetUsd) : null;
	}
	if (input.monthlyBudgetUsd !== undefined) {
		set.monthlyBudgetUsd =
			input.monthlyBudgetUsd && input.monthlyBudgetUsd > 0 ? String(input.monthlyBudgetUsd) : null;
	}
	if (input.budgetAlertsEnabled !== undefined) {
		set.budgetAlertsEnabled = input.budgetAlertsEnabled;
	}
	if (input.budgetAlertThresholdPct !== undefined) {
		// clamp to a sane 1–100% band; out-of-range or NaN falls back to 80
		const pct = Math.floor(input.budgetAlertThresholdPct);
		set.budgetAlertThresholdPct = Number.isFinite(pct) ? Math.min(100, Math.max(1, pct)) : 80;
	}
	if (input.budgetAlertEmail !== undefined) {
		set.budgetAlertEmail = input.budgetAlertEmail?.trim() || null;
	}
	if (input.tracingEnabled !== undefined) {
		set.tracingEnabled = input.tracingEnabled;
	}
	if (input.tracingRetentionDays !== undefined) {
		// at least 1 day; out-of-range or NaN falls back to the 30-day default
		const days = Math.floor(input.tracingRetentionDays);
		set.tracingRetentionDays = Number.isFinite(days) ? Math.max(1, days) : 30;
	}
	await db
		.insert(settings)
		.values({ id: 1, ...set })
		.onConflictDoUpdate({
			target: settings.id,
			set
		});
}

/* ------------------------------------ audit ------------------------------------- */

export function listAudit(limit = 100) {
	return db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			status: auditLog.status,
			provider: auditLog.provider,
			model: auditLog.model,
			statusCode: auditLog.statusCode,
			costUsd: auditLog.costUsd,
			providerCachedTokens: auditLog.providerCachedTokens,
			latencyMs: auditLog.latencyMs,
			ip: auditLog.ip,
			detail: auditLog.detail,
			serviceName: service.name,
			createdAt: auditLog.createdAt
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.orderBy(desc(auditLog.createdAt))
		.limit(limit);
}

/* ------------------------------------ traces ------------------------------------ */

/**
 * List captured request traces for the trace viewer, newest first. Joins the
 * paired audit row for the metadata (status, model, cost, tokens, latency) and
 * the service name; payloads are loaded lazily by {@link getTrace} on the detail
 * view, so the list query stays light.
 */
export function listTraces(limit = 100) {
	return db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			format: requestTrace.responseFormat,
			groupId: requestTrace.traceGroupId,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.orderBy(desc(requestTrace.createdAt))
		.limit(limit);
}

/**
 * Clustered feed for the traces list: each session (calls sharing a group id)
 * collapses into ONE summary row, while ungrouped calls stay individual. The two
 * are merged and sorted by recency. Discriminated by `kind` ('session' | 'call').
 */
export async function listTraceFeed(limit = 100, meta?: MetaFilter | null) {
	// optional metadata predicate: exact key/value containment, or key existence
	const metaCond =
		meta == null
			? undefined
			: meta.value != null
				? sql`${requestTrace.metadata} @> ${JSON.stringify({ [meta.key]: meta.value })}::jsonb`
				: sql`jsonb_exists(${requestTrace.metadata}, ${meta.key})`;

	const sessions = await db
		.select({
			groupId: requestTrace.traceGroupId,
			calls: sql<number>`count(*)::int`,
			errorCount: sql<number>`count(*) filter (where ${auditLog.status} not in ('ok', 'allow'))::int`,
			at: sql<Date>`max(${requestTrace.createdAt})`,
			costUsd: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::int`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::int`,
			models: sql<string[]>`array_remove(array_agg(distinct ${auditLog.model}), null)`,
			serviceName: sql<string | null>`max(${service.name})`
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(and(isNotNull(requestTrace.traceGroupId), ...(metaCond ? [metaCond] : [])))
		.groupBy(requestTrace.traceGroupId)
		.orderBy(desc(sql`max(${requestTrace.createdAt})`))
		.limit(limit);

	const calls = await db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			format: requestTrace.responseFormat,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(and(isNull(requestTrace.traceGroupId), ...(metaCond ? [metaCond] : [])))
		.orderBy(desc(requestTrace.createdAt))
		.limit(limit);

	const feed = [
		...sessions.map((s) => ({ kind: 'session' as const, ...s })),
		...calls.map((c) => ({ kind: 'call' as const, at: c.createdAt, ...c }))
	];
	feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	return feed.slice(0, limit);
}

/**
 * The other traces sharing a caller-supplied group id, oldest first — the
 * session timeline shown on a trace's detail view. Metadata only (no payloads).
 */
export function listTraceGroup(groupId: string, limit = 100) {
	return db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.where(eq(requestTrace.traceGroupId, groupId))
		.orderBy(requestTrace.createdAt)
		.limit(limit);
}

/* --------------------------------- otlp spans --------------------------------- */

/**
 * One summary row per ingested OTLP trace (newest first): the root span's name,
 * total span count, wall-clock duration, an error flag, and the service. Two
 * queries — aggregates grouped by trace id, then the earliest root span's name —
 * merged in code, since picking the root per group isn't a plain aggregate.
 */
export async function listOtelTraces(limit = 100) {
	const agg = await db
		.select({
			traceId: traceSpan.traceId,
			spanCount: sql<number>`count(*)::int`,
			errorCount: sql<number>`count(*) filter (where ${traceSpan.status} = 'error')::int`,
			startedAt: sql<Date>`min(${traceSpan.startedAt})`,
			// wall clock = latest span end − earliest span start, in ms
			durationMs: sql<number>`(extract(epoch from max(${traceSpan.startedAt})) * 1000 + max(${traceSpan.durationMs}) - extract(epoch from min(${traceSpan.startedAt})) * 1000)::int`,
			serviceName: sql<string | null>`max(${traceSpan.serviceName})`
		})
		.from(traceSpan)
		.groupBy(traceSpan.traceId)
		.orderBy(desc(sql`min(${traceSpan.startedAt})`))
		.limit(limit);

	if (agg.length === 0) return [];

	// earliest root (parent-less) span per trace → the trace's display name
	const ids = agg.map((a) => a.traceId);
	const roots = await db
		.select({ traceId: traceSpan.traceId, name: traceSpan.name, startedAt: traceSpan.startedAt })
		.from(traceSpan)
		.where(and(inArray(traceSpan.traceId, ids), isNull(traceSpan.parentSpanId)))
		.orderBy(traceSpan.startedAt);
	const rootName = new Map<string, string>();
	for (const r of roots) if (!rootName.has(r.traceId)) rootName.set(r.traceId, r.name);

	return agg.map((a) => ({ ...a, rootName: rootName.get(a.traceId) ?? '(trace)' }));
}

/** All spans of one ingested trace, oldest first, for the tree/waterfall view. */
export function getOtelTrace(traceId: string) {
	return db
		.select({
			spanId: traceSpan.spanId,
			parentSpanId: traceSpan.parentSpanId,
			name: traceSpan.name,
			kind: traceSpan.kind,
			status: traceSpan.status,
			startedAt: traceSpan.startedAt,
			durationMs: traceSpan.durationMs,
			serviceName: traceSpan.serviceName,
			attributes: traceSpan.attributes
		})
		.from(traceSpan)
		.where(eq(traceSpan.traceId, traceId))
		.orderBy(traceSpan.startedAt);
}

/**
 * Every call in a session (by group id), oldest first, WITH payloads — so the
 * full-session view can stitch the whole run's conversation onto one page.
 */
export function getTraceGroupDetail(groupId: string, limit = 200) {
	return db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			requestBody: requestTrace.requestBody,
			responseBody: requestTrace.responseBody,
			format: requestTrace.responseFormat,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(eq(requestTrace.traceGroupId, groupId))
		.orderBy(requestTrace.createdAt)
		.limit(limit);
}

/** Load a single trace with its full request/response payloads and metadata. */
export async function getTrace(id: string) {
	const [row] = await db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			requestBody: requestTrace.requestBody,
			responseBody: requestTrace.responseBody,
			format: requestTrace.responseFormat,
			groupId: requestTrace.traceGroupId,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			providerCachedTokens: auditLog.providerCachedTokens,
			cacheWriteTokens: auditLog.cacheWriteTokens,
			latencyMs: auditLog.latencyMs,
			ip: auditLog.ip,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(eq(requestTrace.id, id))
		.limit(1);
	return row ?? null;
}

/** Aggregate dashboard stats for the overview page. */
export async function orgStats() {
	const [counts] = await db
		.select({
			services: sql<number>`count(distinct ${service.id})`
		})
		.from(service)
		.where(isNull(service.deletedAt));

	const [tokenCount] = await db
		.select({ active: sql<number>`count(*) filter (where ${machineToken.revokedAt} is null)` })
		.from(machineToken);

	const [providerCount] = await db.select({ count: sql<number>`count(*)` }).from(providerSecret);

	const [reqs] = await db
		.select({
			total: sql<number>`count(*)`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`,
			denied: sql<number>`count(*) filter (where ${auditLog.status} = 'deny')`,
			// cache hits log detail 'cache hit' / 'cache hit (stream)' at cost 0
			cacheHits: sql<number>`count(*) filter (where ${auditLog.detail} like 'cache hit%')`,
			// exact savings: each hit recorded the cached entry's original cost
			cacheSaved: sql<string>`coalesce(sum(${auditLog.savedUsd}), 0)`,
			// input tokens the upstream providers served from their own prompt cache
			providerCachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)`,
			// LLM tokens billed by upstream — sums separately so the overview can
			// show prompt vs completion volume alongside the dollar figure.
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			// tokens uprox's response cache saved this window — replayed from the
			// stored miss totals on every hit. Folded into the token-based cache
			// rate so the headline reflects both layers of caching.
			savedInputTokens: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			savedOutputTokens: sql<number>`coalesce(sum(${auditLog.savedOutputTokens}), 0)::bigint`,
			// embedding input is never eligible for prompt caching; broken out so it
			// can be excluded from the cache-rate denominator below.
			embeddingInputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}) filter (where ${auditLog.model} ilike '%embedding%'), 0)::bigint`
		})
		.from(auditLog)
		.where(sql`${auditLog.action} like 'gateway.%'`);

	const cacheHits = Number(reqs?.cacheHits ?? 0);
	const total = Number(reqs?.total ?? 0);
	const inputTokens = Number(reqs?.inputTokens ?? 0);
	const outputTokens = Number(reqs?.outputTokens ?? 0);
	const savedInputTokens = Number(reqs?.savedInputTokens ?? 0);
	const savedOutputTokens = Number(reqs?.savedOutputTokens ?? 0);
	const providerCachedTokens = Number(reqs?.providerCachedTokens ?? 0);
	const embeddingInputTokens = Number(reqs?.embeddingInputTokens ?? 0);

	// share of input tokens that benefited from any cache layer — see cacheRate()
	const { rate: tokenCacheRate } = cacheRate({
		inputTokens,
		embeddingInputTokens,
		savedInputTokens,
		providerCachedTokens
	});

	return {
		services: Number(counts?.services ?? 0),
		providers: Number(providerCount?.count ?? 0),
		activeTokens: Number(tokenCount?.active ?? 0),
		requests: total,
		denied: Number(reqs?.denied ?? 0),
		costUsd: Number(reqs?.cost ?? 0),
		cacheHits,
		// share of all gateway requests served from uprox's cache (0–1) — kept
		// for callers that want the request-count view, but the headline tile
		// now uses tokenCacheRate so provider cache counts too.
		cacheHitRate: total > 0 ? cacheHits / total : 0,
		// share of input tokens that benefited from any cache layer (0–1)
		tokenCacheRate,
		// exact: sum of each hit's recorded saved amount
		cacheSavedUsd: Number(reqs?.cacheSaved ?? 0),
		// total input tokens upstream providers served from their own prompt cache
		providerCachedTokens,
		inputTokens,
		outputTokens,
		savedInputTokens,
		savedOutputTokens
	};
}

export interface DailyStat {
	date: string;
	requests: number;
	denied: number;
	costUsd: number;
}

/**
 * Per-day gateway traffic for the last `days` days, including empty days so the
 * overview sparkline keeps a steady width. Returned oldest-first.
 */
export async function orgDailyStats(days = 14): Promise<DailyStat[]> {
	const rows = await db.execute<{
		day: string;
		requests: number;
		denied: number;
		cost: string;
	}>(sql`
		select
			to_char(d.day, 'YYYY-MM-DD') as day,
			count(${auditLog.id})::int as requests,
			(count(${auditLog.id}) filter (where ${auditLog.status} = 'deny'))::int as denied,
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost
		from generate_series(
			current_date - make_interval(days => ${days - 1}),
			current_date,
			interval '1 day'
		) as d(day)
		left join ${auditLog}
			on ${auditLog.createdAt}::date = d.day::date
			and ${auditLog.action} like 'gateway.%'
		group by d.day
		order by d.day asc
	`);

	return rows.map((r) => ({
		date: r.day,
		requests: Number(r.requests ?? 0),
		denied: Number(r.denied ?? 0),
		costUsd: Number(r.cost ?? 0)
	}));
}

export interface UsageSeriesPoint {
	/** UTC-aligned bucket start, ISO-8601 with a trailing Z (e.g. 2026-06-03T00:00:00Z) */
	bucket: string;
	requests: number;
	denied: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
}

export interface UsageSeries {
	/** bucket granularity used for the window (see resolveSeriesBucket) */
	unit: SeriesBucket;
	points: UsageSeriesPoint[];
}

/** Postgres `date_trunc`/`generate_series` step for each bucket unit. */
const BUCKET_STEP: Record<SeriesBucket, string> = {
	hour: '1 hour',
	day: '1 day',
	week: '1 week',
	month: '1 month'
};

/**
 * Time-series of gateway traffic across the resolved window, bucketed hourly,
 * daily, weekly, or monthly and optionally scoped to one service. The bucket is
 * picked by `resolveSeriesBucket` from the operator's `unit` choice (default
 * `'auto'`). Powers the "trend over time" chart on the usage and service-detail
 * pages. `generate_series` fills empty buckets so the chart keeps a steady width;
 * the query mirrors the `orgDailyStats` shape (oldest-first, denied broken out).
 *
 * `created_at` is `timestamp without time zone` holding UTC wall-clock instants
 * (the same the budget windows enforce against), so the window bounds are bound
 * as ISO strings cast with `::timestamp` — which discards the `Z` offset and
 * keeps everything UTC-aligned — and never as JS `Date` objects, which a raw
 * `db.execute` template can't bind.
 */
export async function orgUsageSeries(
	range: ResolvedRange,
	opts: {
		serviceId?: string;
		tokenId?: string;
		unit?: BucketChoice;
		/** dimension filters from the cost-analysis toolbar */
		filters?: UsageFilter[];
	} = {}
): Promise<UsageSeries> {
	const unit = resolveSeriesBucket(range, opts.unit ?? 'auto');
	const step = BUCKET_STEP[unit];
	const startIso = range.start.toISOString();
	// open-ended rolling windows run up to "now"
	const upperIso = (range.end ?? new Date()).toISOString();
	const serviceFilter = opts.serviceId
		? sql`and ${auditLog.serviceId} = ${opts.serviceId}::uuid`
		: sql``;
	const tokenFilter = opts.tokenId ? sql`and ${auditLog.tokenId} = ${opts.tokenId}::uuid` : sql``;
	const dimFilters = (opts.filters ?? []).map((f) => sql`and ${filterCond(f)}`);

	const rows = await db.execute<{
		bucket: string;
		requests: number;
		denied: number;
		cost: string;
		input_tokens: number;
		output_tokens: number;
	}>(sql`
		select
			to_char(g.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket,
			count(${auditLog.id})::int as requests,
			(count(${auditLog.id}) filter (where ${auditLog.status} = 'deny'))::int as denied,
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost,
			coalesce(sum(${auditLog.inputTokens}), 0)::bigint as input_tokens,
			coalesce(sum(${auditLog.outputTokens}), 0)::bigint as output_tokens
		from generate_series(
			date_trunc(${unit}, ${startIso}::timestamp),
			date_trunc(${unit}, ${upperIso}::timestamp),
			${step}::interval
		) as g(bucket)
		left join ${auditLog}
			on date_trunc(${unit}, ${auditLog.createdAt}) = g.bucket
			and ${auditLog.action} like 'gateway.%'
			${serviceFilter}
			${tokenFilter}
			${sql.join(dimFilters, sql` `)}
		group by g.bucket
		order by g.bucket asc
	`);

	return {
		unit,
		points: rows.map((r) => ({
			bucket: r.bucket,
			requests: Number(r.requests ?? 0),
			denied: Number(r.denied ?? 0),
			costUsd: Number(r.cost ?? 0),
			inputTokens: Number(r.input_tokens ?? 0),
			outputTokens: Number(r.output_tokens ?? 0)
		}))
	};
}

/* ----------------------------------- usage -------------------------------------- */

/**
 * The shared filter for the usage breakdowns: gateway traffic inside a resolved
 * time window, optionally narrowed to one service and/or one machine token.
 * Rolling windows carry no `end`; calendar buckets bound the upper edge
 * exclusively. Pass the result to `and(...)` — `undefined` legs are ignored by
 * drizzle.
 */
function usageConds(
	range: ResolvedRange,
	serviceId?: string,
	tokenId?: string,
	filters?: UsageFilter[]
) {
	return [
		sql`${auditLog.action} like 'gateway.%'`,
		gte(auditLog.createdAt, range.start),
		range.end ? lt(auditLog.createdAt, range.end) : undefined,
		serviceId ? eq(auditLog.serviceId, serviceId) : undefined,
		tokenId ? eq(auditLog.tokenId, tokenId) : undefined,
		...(filters ?? []).map(filterCond)
	];
}

/* ------------------------- dimension → column mapping ------------------------- */

/**
 * The SQL identity of each groupable dimension. This map is the ONLY place a
 * dimension key becomes a column, which is what keeps the URL-supplied `group=`
 * and `f=` values safe: an unknown key never reaches here (it's rejected by
 * `isUsageDimension` first), and the values themselves are always bound as
 * parameters, never interpolated.
 *
 * `value` is compared and grouped as text — including for the uuid columns — so
 * a hand-edited filter value can't blow up the query with a uuid cast error, and
 * so NULLs (a deleted service, a denial that never resolved a model) collapse to
 * one addressable `NULL_VALUE` bucket instead of vanishing from the grouping.
 */
/**
 * The dimensions that really are a column on `audit_log`. `meter` is excluded by
 * construction: it's a decomposition of a row's token counts, not a property of
 * the row, so typing these maps over this narrower set makes "a meter reached
 * the SQL layer" a compile error rather than a runtime surprise.
 */
type SqlDimension = Exclude<UsageDimension, 'meter'>;

const DIMENSION_SQL: Record<
	SqlDimension,
	{ value: ReturnType<typeof sql>; label: ReturnType<typeof sql>; hint?: ReturnType<typeof sql> }
> = {
	service: {
		value: sql`coalesce(${auditLog.serviceId}::text, ${NULL_VALUE})`,
		label: sql`max(${service.name})`
	},
	model: {
		value: sql`coalesce(${auditLog.model}, ${NULL_VALUE})`,
		label: sql`max(${auditLog.model})`,
		hint: sql`max(${auditLog.provider})`
	},
	provider: {
		value: sql`coalesce(${auditLog.provider}, ${NULL_VALUE})`,
		label: sql`max(${auditLog.provider})`
	},
	token: {
		value: sql`coalesce(${auditLog.tokenId}::text, ${NULL_VALUE})`,
		label: sql`max(${machineToken.name})`,
		hint: sql`max(${machineToken.display})`
	},
	status: {
		value: sql`coalesce(${auditLog.status}, ${NULL_VALUE})`,
		label: sql`max(${auditLog.status})`
	}
};

/**
 * The join a dimension needs to resolve its human-readable label. Only the id
 * dimensions need one — a query grouping by model shouldn't pay for the service
 * join. Empty fragments are a no-op when interpolated.
 */
const DIMENSION_JOIN: Record<SqlDimension, ReturnType<typeof sql>> = {
	service: sql`left join ${service} on ${service.id} = ${auditLog.serviceId}`,
	token: sql`left join ${machineToken} on ${machineToken.id} = ${auditLog.tokenId}`,
	model: sql``,
	provider: sql``,
	status: sql``
};

/** One filter clause: OR within the dimension's values, AND across dimensions. */
function filterCond(f: UsageFilter) {
	const entry = DIMENSION_SQL[f.dim as SqlDimension];
	// Belt and braces: parseFilters already drops non-filterable dimensions, so a
	// meter can't get here — but a filter with no column must be a no-op rather
	// than a crash or, worse, a silently dropped AND leg.
	if (!entry) return sql`true`;
	const col = entry.value;
	// Each value is its own bound parameter — never interpolated — so the list is
	// inert regardless of what the URL carried.
	const list = sql.join(
		f.values.map((v) => sql`${v}`),
		sql`, `
	);
	return sql`${col} in (${list})`;
}

/**
 * The usage predicate as a single raw-SQL fragment, for the queries built with
 * `db.execute` rather than the query builder (the time-series ones, which need
 * `generate_series`). Same semantics as {@link usageConds}; the bounds are bound
 * as ISO strings cast with `::timestamp` — discarding the `Z` and staying
 * UTC-aligned — because a raw template can't bind a JS `Date`.
 */
function usageCondsSql(range: ResolvedRange, filters?: UsageFilter[]) {
	const parts = [
		sql`${auditLog.action} like 'gateway.%'`,
		sql`${auditLog.createdAt} >= ${range.start.toISOString()}::timestamp`,
		...(range.end ? [sql`${auditLog.createdAt} < ${range.end.toISOString()}::timestamp`] : []),
		...(filters ?? []).map(filterCond)
	];
	return sql.join(parts, sql` and `);
}

export interface ModelUsage {
	model: string;
	provider: string | null;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic grouped by model over the window, busiest first. Powers the
 * "usage by model" breakdown on the usage page and (with `serviceId`) the
 * per-service detail page.
 */
export async function orgUsageByModel(
	range: ResolvedRange,
	opts: { serviceId?: string; tokenId?: string; limit?: number } = {}
): Promise<ModelUsage[]> {
	const rows = await db
		.select({
			model: auditLog.model,
			// a model is served by a single provider; max() picks a stable non-null id
			provider: sql<string | null>`max(${auditLog.provider})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.where(
			and(sql`${auditLog.model} is not null`, ...usageConds(range, opts.serviceId, opts.tokenId))
		)
		.groupBy(auditLog.model)
		.orderBy(desc(sql`count(*)`))
		.limit(opts.limit ?? 50);

	return rows.map((r) => ({
		model: r.model as string,
		provider: r.provider,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0)
	}));
}

export interface ProviderUsage {
	provider: string;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic grouped by upstream provider over the window, busiest first.
 * Coarser than the by-model breakdown — answers "where is the spend landing,
 * OpenAI vs Anthropic vs Azure" at a glance. Rows with no recorded provider
 * (e.g. denials before routing) are dropped.
 */
export async function orgUsageByProvider(
	range: ResolvedRange,
	opts: { serviceId?: string; tokenId?: string } = {}
): Promise<ProviderUsage[]> {
	const rows = await db
		.select({
			provider: auditLog.provider,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.where(
			and(sql`${auditLog.provider} is not null`, ...usageConds(range, opts.serviceId, opts.tokenId))
		)
		.groupBy(auditLog.provider)
		.orderBy(desc(sql`count(*)`));

	return rows.map((r) => ({
		provider: r.provider as string,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0)
	}));
}

export interface ServiceUsage {
	serviceId: string | null;
	serviceName: string | null;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
	savedInputTokens: number;
	savedOutputTokens: number;
	/** input tokens this service had served from the upstream provider's prompt cache */
	providerCachedTokens: number;
}

/**
 * Gateway traffic grouped by the calling service over the window, busiest first.
 * Requests whose service was since deleted group under a null id.
 */
export async function orgUsageByService(range: ResolvedRange): Promise<ServiceUsage[]> {
	const rows = await db
		.select({
			serviceId: auditLog.serviceId,
			serviceName: sql<string | null>`max(${service.name})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			savedInputTokens: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			savedOutputTokens: sql<number>`coalesce(sum(${auditLog.savedOutputTokens}), 0)::bigint`,
			providerCachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)::bigint`
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.where(and(...usageConds(range)))
		.groupBy(auditLog.serviceId)
		.orderBy(desc(sql`count(*)`));

	return rows.map((r) => ({
		serviceId: r.serviceId,
		serviceName: r.serviceName,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0),
		savedInputTokens: Number(r.savedInputTokens ?? 0),
		savedOutputTokens: Number(r.savedOutputTokens ?? 0),
		providerCachedTokens: Number(r.providerCachedTokens ?? 0)
	}));
}

export interface TokenUsage {
	tokenId: string | null;
	tokenName: string | null;
	tokenDisplay: string | null;
	serviceName: string | null;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic grouped by the calling machine token over the window, busiest
 * first. Lets operators see which individual API key is driving spend (a service
 * can carry multiple tokens; a leaked one would stand out here long before the
 * per-service total looks unusual). Revoked tokens are still surfaced so
 * historical activity remains attributable. With `serviceId`, scopes to the
 * tokens of one service for the detail page.
 */
export async function orgUsageByToken(
	range: ResolvedRange,
	opts: { serviceId?: string; limit?: number } = {}
): Promise<TokenUsage[]> {
	const rows = await db
		.select({
			tokenId: auditLog.tokenId,
			tokenName: sql<string | null>`max(${machineToken.name})`,
			tokenDisplay: sql<string | null>`max(${machineToken.display})`,
			serviceName: sql<string | null>`max(${service.name})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.leftJoin(machineToken, eq(machineToken.id, auditLog.tokenId))
		.leftJoin(service, eq(service.id, machineToken.serviceId))
		.where(and(sql`${auditLog.tokenId} is not null`, ...usageConds(range, opts.serviceId)))
		.groupBy(auditLog.tokenId)
		.orderBy(desc(sql`count(*)`))
		.limit(opts.limit ?? 50);

	return rows.map((r) => ({
		tokenId: r.tokenId,
		tokenName: r.tokenName,
		tokenDisplay: r.tokenDisplay,
		serviceName: r.serviceName,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0)
	}));
}

/* ------------------------ grouped (cost-analysis) usage ----------------------- */

/** One row of a by-dimension breakdown: a single series' totals over the window. */
export interface DimensionUsageRow {
	/** the raw grouping value — a uuid, a model name, or NULL_VALUE/OTHERS_KEY */
	key: string;
	/** display name; falls back to the key when the joined row is gone */
	label: string;
	/** secondary detail (a model's provider, a token's masked display) */
	hint: string | null;
	costUsd: number;
	requests: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic over the window grouped by an arbitrary dimension, ranked by
 * spend. This is the generalisation of the four hand-written `orgUsageByX`
 * breakdowns above, and the single source for the cost-analysis page's donuts,
 * detail table, and the series ranking the stacked chart stacks in.
 *
 * Ranked by cost (not request count, which the older breakdowns use) because
 * this drives a *cost* analysis: the series worth a colour slot is the expensive
 * one, not merely the chatty one. Ties fall back to request count so a window of
 * all-zero spend still ranks deterministically.
 */
export async function orgUsageByDimension(
	range: ResolvedRange,
	dim: UsageDimension,
	opts: { filters?: UsageFilter[]; limit?: number; serviceId?: string; tokenId?: string } = {}
): Promise<DimensionUsageRow[]> {
	// `meter` isn't a column — it's a decomposition of each row's token counts —
	// so it's served by the meter aggregate rather than a group-by.
	if (dim === 'meter') {
		const b = await orgTokenMeters(range, {
			filters: opts.filters,
			serviceId: opts.serviceId,
			tokenId: opts.tokenId
		});
		return b.meters
			.filter((m) => m.tokens > 0)
			.map((m) => ({
				key: m.key,
				label: METER_ORDER.find((x) => x.key === m.key)?.label ?? m.key,
				hint: null,
				costUsd: m.costUsd,
				// A request contributes to several meters at once, so "requests per
				// meter" has no meaning; left at zero rather than invented.
				requests: 0,
				denied: 0,
				inputTokens: m.key === 'output' ? 0 : m.tokens,
				outputTokens: m.key === 'output' ? m.tokens : 0
			}))
			.sort((x, y) => y.costUsd - x.costUsd);
	}

	const d = DIMENSION_SQL[dim as SqlDimension];
	const join = DIMENSION_JOIN[dim as SqlDimension];
	const scope = [
		...(opts.serviceId ? [sql`${auditLog.serviceId} = ${opts.serviceId}::uuid`] : []),
		...(opts.tokenId ? [sql`${auditLog.tokenId} = ${opts.tokenId}::uuid`] : [])
	];
	const where = sql.join([usageCondsSql(range, opts.filters), ...scope], sql` and `);

	const rows = await db.execute<{
		key: string;
		label: string | null;
		hint: string | null;
		cost: string;
		requests: number;
		denied: number;
		input_tokens: number;
		output_tokens: number;
	}>(sql`
		select
			${d.value} as key,
			${d.label} as label,
			${d.hint ?? sql`null::text`} as hint,
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost,
			count(*)::int as requests,
			(count(*) filter (where ${auditLog.status} = 'deny'))::int as denied,
			coalesce(sum(${auditLog.inputTokens}), 0)::bigint as input_tokens,
			coalesce(sum(${auditLog.outputTokens}), 0)::bigint as output_tokens
		from ${auditLog}
		${join}
		where ${where}
		-- Group by the select ordinal, not by repeating the expression: the NULL
		-- sentinel inside it is a bound parameter, and two occurrences bind as two
		-- distinct placeholders, so Postgres would not recognise them as the same
		-- expression ("must appear in the GROUP BY clause").
		group by 1
		order by coalesce(sum(${auditLog.costUsd}), 0) desc, count(*) desc
		${opts.limit ? sql`limit ${opts.limit}` : sql``}
	`);

	return rows.map((r) => ({
		key: r.key,
		label: r.label ?? fallbackLabel(dim, r.key),
		hint: r.hint,
		costUsd: Number(r.cost ?? 0),
		requests: Number(r.requests ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.input_tokens ?? 0),
		outputTokens: Number(r.output_tokens ?? 0)
	}));
}

/**
 * What to call a series whose joined row no longer exists (a deleted service, a
 * revoked-and-purged token) or whose column was NULL. Naming it explicitly beats
 * showing a bare uuid, and beats dropping the row — the spend was real and still
 * has to reconcile against the total.
 */
function fallbackLabel(dim: UsageDimension, key: string): string {
	if (key === OTHERS_KEY) return 'Others';
	if (key !== NULL_VALUE) return key;
	if (dim === 'service') return 'Deleted service';
	if (dim === 'token') return 'Revoked token';
	if (dim === 'model') return 'No model';
	if (dim === 'provider') return 'Unrouted';
	return 'Unknown';
}

/** One coloured band of the stacked chart: a series and its value per bucket. */
export interface GroupedSeries {
	key: string;
	label: string;
	hint: string | null;
	/** aligned 1:1 with {@link GroupedSeriesResult.buckets} */
	points: { requests: number; denied: number; costUsd: number; tokens: number }[];
	/** window totals, for the legend and tooltip */
	costUsd: number;
	requests: number;
	tokens: number;
}

export interface GroupedSeriesResult {
	unit: SeriesBucket;
	/** UTC-aligned bucket starts, ISO-8601 with a trailing Z */
	buckets: string[];
	series: GroupedSeries[];
	/** true when traffic outside the top-N was folded into the "Others" series */
	hasOthers: boolean;
}

/**
 * Traffic over the window, bucketed in time AND split by a dimension — the query
 * behind the stacked cost chart.
 *
 * Runs in two passes rather than one: first rank the dimension to find the
 * top-N series, then fetch the time split with everything outside that set
 * folded into a single `Others` band. The alternative — pulling every
 * (bucket, series) pair and rolling up in JS — is unbounded on a dimension like
 * model, where a busy month can carry hundreds of distinct values.
 *
 * The `generate_series × unnest` cross join pads every (bucket, series) cell, so
 * the returned arrays are dense and the chart can index them positionally
 * without gap-checking. A series that was quiet in a bucket gets a real zero.
 */
export async function orgUsageSeriesGrouped(
	range: ResolvedRange,
	dim: UsageDimension,
	opts: {
		unit?: BucketChoice;
		filters?: UsageFilter[];
		/** how many real series get their own band before the rest fold into Others */
		limit?: number;
		/** narrow to one service / token, for the detail pages */
		serviceId?: string;
		tokenId?: string;
	} = {}
): Promise<GroupedSeriesResult> {
	if (dim === 'meter') {
		return orgTokenMetersSeries(range, {
			unit: opts.unit,
			filters: opts.filters,
			serviceId: opts.serviceId,
			tokenId: opts.tokenId
		});
	}

	const unit = resolveSeriesBucket(range, opts.unit ?? 'auto');
	const step = BUCKET_STEP[unit];
	const startIso = range.start.toISOString();
	const upperIso = (range.end ?? new Date()).toISOString();
	const limit = opts.limit ?? 8;
	// The page-level scope, applied identically to the ranking pass and the
	// time-split pass so the bands can't sum to more than the scoped total.
	const scope = sql.join(
		[
			...(opts.serviceId ? [sql`${auditLog.serviceId} = ${opts.serviceId}::uuid`] : []),
			...(opts.tokenId ? [sql`${auditLog.tokenId} = ${opts.tokenId}::uuid`] : [])
		].map((c) => sql` and ${c}`),
		sql``
	);

	const ranked = await orgUsageByDimension(range, dim, {
		filters: opts.filters,
		serviceId: opts.serviceId,
		tokenId: opts.tokenId
	});
	const top = ranked.slice(0, limit);
	const hasOthers = ranked.length > top.length;

	// Nothing to stack. Returns empty arrays rather than a padded axis: with no
	// series there is no axis to pad against, and the chart's own empty state
	// reads better than a grid of zeroes.
	if (top.length === 0) {
		return { unit, buckets: [], series: [], hasOthers: false };
	}

	const d = DIMENSION_SQL[dim as SqlDimension];
	const topKeys = top.map((r) => r.key);
	const keyList = sql.join(
		topKeys.map((k) => sql`${k}`),
		sql`, `
	);
	// The key each row contributes to: itself if it's a top-N series, else the
	// Others bucket. Computed in SQL so the fold happens before the group-by.
	const foldedKey = sql`(case when ${d.value} in (${keyList}) then ${d.value} else ${OTHERS_KEY} end)`;
	// The axis of series to pad against — the top-N plus Others when non-empty.
	const axisKeys = hasOthers ? [...topKeys, OTHERS_KEY] : topKeys;
	const axisList = sql.join(
		axisKeys.map((k) => sql`${k}`),
		sql`, `
	);

	const rows = await db.execute<{
		bucket: string;
		key: string;
		requests: number;
		denied: number;
		cost: string;
		tokens: number;
	}>(sql`
		select
			to_char(g.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket,
			k.key as key,
			count(${auditLog.id})::int as requests,
			(count(${auditLog.id}) filter (where ${auditLog.status} = 'deny'))::int as denied,
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost,
			coalesce(sum(coalesce(${auditLog.inputTokens}, 0) + coalesce(${auditLog.outputTokens}, 0)), 0)::bigint as tokens
		from generate_series(
			date_trunc(${unit}, ${startIso}::timestamp),
			date_trunc(${unit}, ${upperIso}::timestamp),
			${step}::interval
		) as g(bucket)
		cross join (select unnest(array[${axisList}]::text[]) as key) as k
		-- no label join here: the grouping expressions read audit_log columns only,
		-- and the display names already came back with the ranking pass above
		left join ${auditLog}
			on date_trunc(${unit}, ${auditLog.createdAt}) = g.bucket
			and ${foldedKey} = k.key
			and ${usageCondsSql(range, opts.filters)}${scope}
		group by g.bucket, k.key
		order by g.bucket asc
	`);

	// Positional rebuild: buckets in first-seen (ascending) order, then one dense
	// point array per series indexed by that bucket order.
	const buckets: string[] = [];
	const bucketIndex = new Map<string, number>();
	for (const r of rows) {
		if (!bucketIndex.has(r.bucket)) {
			bucketIndex.set(r.bucket, buckets.length);
			buckets.push(r.bucket);
		}
	}

	const meta = new Map(top.map((r) => [r.key, r]));
	const series: GroupedSeries[] = axisKeys.map((key) => {
		const m = meta.get(key);
		return {
			key,
			label: m?.label ?? fallbackLabel(dim, key),
			hint: m?.hint ?? null,
			points: buckets.map(() => ({ requests: 0, denied: 0, costUsd: 0, tokens: 0 })),
			costUsd: 0,
			requests: 0,
			tokens: 0
		};
	});
	const seriesIndex = new Map(series.map((s, i) => [s.key, i]));

	for (const r of rows) {
		const si = seriesIndex.get(r.key);
		const bi = bucketIndex.get(r.bucket);
		if (si === undefined || bi === undefined) continue;
		const s = series[si];
		const point = {
			requests: Number(r.requests ?? 0),
			denied: Number(r.denied ?? 0),
			costUsd: Number(r.cost ?? 0),
			tokens: Number(r.tokens ?? 0)
		};
		s.points[bi] = point;
		s.costUsd += point.costUsd;
		s.requests += point.requests;
		s.tokens += point.tokens;
	}

	return { unit, buckets, series, hasOthers };
}

/**
 * The values each dimension can be filtered to, derived from the traffic
 * actually present in the window. Deriving from traffic rather than from the
 * service/token tables means the picker never offers a service that hasn't
 * called the gateway — and still offers a deleted one that did.
 *
 * Deliberately computed against the *unfiltered* window so removing a pill can
 * always be undone; a picker that narrowed itself as you filtered would make
 * some combinations unreachable.
 */
export async function orgUsageFilterOptions(
	range: ResolvedRange,
	dims: readonly UsageDimension[],
	opts: { limit?: number; serviceId?: string; tokenId?: string } = {}
): Promise<UsageFilterOptions> {
	const limit = opts.limit ?? 100;
	const entries = await Promise.all(
		dims.map(async (dim) => {
			const rows = await orgUsageByDimension(range, dim, {
				limit,
				serviceId: opts.serviceId,
				tokenId: opts.tokenId
			});
			const options: UsageFilterOption[] = rows.map((r) => ({
				value: r.key,
				label: r.label,
				hint: r.hint
			}));
			return [dim, options] as const;
		})
	);
	return Object.fromEntries(entries) as UsageFilterOptions;
}

/* -------------------------------- top movers --------------------------------- */

export interface UsageMover {
	key: string;
	label: string;
	currentUsd: number;
	previousUsd: number;
	deltaUsd: number;
	/** null when there's no prior baseline to divide by (a new series) */
	deltaPct: number | null;
	isNew: boolean;
	isGone: boolean;
}

/**
 * The series whose spend moved most between the selected window and the
 * immediately-preceding one of equal length — "what changed", which is the first
 * question anyone asks when a bill jumps.
 *
 * Ranked by ABSOLUTE dollar change, not percentage: a model going from $0.01 to
 * $0.05 is +400% and irrelevant, while one going from $400 to $480 is +20% and
 * the actual story. The percentage is still shown, just not what sorts.
 */
export async function orgTopMovers(
	range: ResolvedRange,
	prevRange: ResolvedRange,
	dim: UsageDimension,
	opts: { filters?: UsageFilter[]; serviceId?: string; tokenId?: string; limit?: number } = {}
): Promise<UsageMover[]> {
	const [current, previous] = await Promise.all([
		orgUsageByDimension(range, dim, opts),
		orgUsageByDimension(prevRange, dim, opts)
	]);

	const prevByKey = new Map(previous.map((r) => [r.key, r]));
	const movers: UsageMover[] = current.map((r) => {
		const prior = prevByKey.get(r.key);
		const previousUsd = prior?.costUsd ?? 0;
		return {
			key: r.key,
			label: r.label,
			currentUsd: r.costUsd,
			previousUsd,
			deltaUsd: r.costUsd - previousUsd,
			deltaPct: previousUsd > 0 ? ((r.costUsd - previousUsd) / previousUsd) * 100 : null,
			isNew: previousUsd <= 0 && r.costUsd > 0,
			isGone: false
		};
	});

	// Series that existed before and have gone silent are movers too — arguably
	// the most interesting kind, since a disappearance is easy to miss otherwise.
	const currentKeys = new Set(current.map((r) => r.key));
	for (const r of previous) {
		if (currentKeys.has(r.key) || r.costUsd <= 0) continue;
		movers.push({
			key: r.key,
			label: r.label,
			currentUsd: 0,
			previousUsd: r.costUsd,
			deltaUsd: -r.costUsd,
			deltaPct: -100,
			isNew: false,
			isGone: true
		});
	}

	return movers
		.filter((m) => Math.abs(m.deltaUsd) > 0)
		.sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd))
		.slice(0, opts.limit ?? 8);
}

/* ----------------------------- model efficiency ------------------------------ */

export interface ModelEfficiency {
	model: string;
	provider: string | null;
	requests: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	/** USD per 1,000 tokens (input + output) — the comparable unit price */
	costPer1kTokens: number;
	costPerRequest: number;
	/** output ÷ input; high means verbose answers, which is where cost lands */
	outputRatio: number | null;
	/** share of input served from the provider's prompt cache */
	cacheReadShare: number;
	latencyP50: number | null;
	latencyP95: number | null;
}

/**
 * Per-model unit economics — the table behind "should we switch models".
 *
 * Cost per 1k tokens is the comparable figure: raw spend just says which model
 * you used most. The output ratio sits beside it because a model with a cheap
 * headline rate that answers at twice the length is not cheaper, and that
 * interaction is invisible in any single column.
 */
export async function orgModelEfficiency(
	range: ResolvedRange,
	opts: { filters?: UsageFilter[]; serviceId?: string; tokenId?: string; limit?: number } = {}
): Promise<ModelEfficiency[]> {
	const rows = await db
		.select({
			model: auditLog.model,
			provider: sql<string | null>`max(${auditLog.provider})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			cachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)::bigint`,
			latencyP50: sql<
				number | null
			>`percentile_cont(0.5) within group (order by ${auditLog.latencyMs})`,
			latencyP95: sql<
				number | null
			>`percentile_cont(0.95) within group (order by ${auditLog.latencyMs})`
		})
		.from(auditLog)
		.where(
			and(
				sql`${auditLog.model} is not null`,
				...usageConds(range, opts.serviceId, opts.tokenId, opts.filters)
			)
		)
		.groupBy(auditLog.model)
		.orderBy(desc(sql`coalesce(sum(${auditLog.costUsd}), 0)`))
		.limit(opts.limit ?? 25);

	return rows.map((r) => {
		const input = Number(r.inputTokens ?? 0);
		const output = Number(r.outputTokens ?? 0);
		const cached = Number(r.cachedTokens ?? 0);
		const cost = Number(r.cost ?? 0);
		const requests = Number(r.requests ?? 0);
		const tokens = input + output;
		return {
			model: r.model as string,
			provider: r.provider,
			requests,
			costUsd: cost,
			inputTokens: input,
			outputTokens: output,
			costPer1kTokens: tokens > 0 ? (cost / tokens) * 1000 : 0,
			costPerRequest: requests > 0 ? cost / requests : 0,
			// Embedding models emit no output, so a ratio would be a misleading 0
			// rather than "not applicable" — null renders as an em dash.
			outputRatio: input > 0 && output > 0 ? output / input : null,
			cacheReadShare: input > 0 ? cached / input : 0,
			latencyP50: r.latencyP50 == null ? null : Math.round(Number(r.latencyP50)),
			latencyP95: r.latencyP95 == null ? null : Math.round(Number(r.latencyP95))
		};
	});
}

/* ------------------------------- token meters -------------------------------- */

/**
 * One consumption meter — uprox's answer to an Azure "meter", the sub-line a
 * resource's cost decomposes into. A gateway request doesn't bill as one
 * undifferentiated blob of tokens: fresh input, cache reads, cache writes,
 * output and embeddings are each metered at a different rate (see the
 * `*_per_mtok` columns on model_price), which is exactly why they deserve to be
 * separate rows rather than the two "exclude this" toggles they used to be.
 */
export interface TokenMeter {
	key: 'input' | 'cacheRead' | 'cacheWrite' | 'output' | 'embedding';
	tokens: number;
	/**
	 * Actual spend attributed to this meter. Derived by pricing each meter at its
	 * own list rate and then scaling the five so they sum to the spend actually
	 * recorded — an allocation, not an independent measurement, because the
	 * provider bills one number per request and never itemises it. Scaling is what
	 * keeps the meters reconciling with the headline instead of drifting whenever
	 * a price row is edited after the fact.
	 */
	costUsd: number;
}

export interface TokenMeterBreakdown {
	meters: TokenMeter[];
	/** every metered token in the window — the meters sum to exactly this */
	totalTokens: number;
	/** actual spend recorded for the window */
	costUsd: number;
	/** exact USD uprox's own response cache avoided (replayed requests) */
	savedUsd: number;
	/** input tokens uprox replayed from its response cache (never sent upstream) */
	savedInputTokens: number;
	savedOutputTokens: number;
	/**
	 * Estimated USD the *provider's* prompt cache avoided: cache-read tokens
	 * priced at the delta between full input and the cache-read rate, per model.
	 * An estimate, unlike savedUsd — the provider bills the discount, it doesn't
	 * itemise it — so it is always labelled as such in the UI.
	 */
	providerCacheSavedUsd: number;
}

/**
 * Decompose the window's token volume into its billing meters, with the cost
 * each caching layer avoided.
 *
 * The meters partition the total exactly — every token lands in exactly one row
 * and they sum to `totalTokens` — because a breakdown whose parts don't add up
 * to the whole is worse than no breakdown. Specifically: embeddings are carved
 * out of input/output first (a provider never prompt-caches them), then cache
 * reads are carved out of what's left of input.
 */
export async function orgTokenMeters(
	range: ResolvedRange,
	opts: { filters?: UsageFilter[]; serviceId?: string; tokenId?: string } = {}
): Promise<TokenMeterBreakdown> {
	const embedding = sql`${auditLog.model} ilike '%embedding%'`;
	const conds = usageConds(range, opts.serviceId, opts.tokenId, opts.filters);

	// Per-model so the provider-cache saving can be priced at that model's own
	// rate; the meters themselves are just sums and get folded together after.
	const rows = await db
		.select({
			model: auditLog.model,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			// Cache reads split by whether the row is an embedding call. Only the
			// non-embedding portion becomes its own meter: an embedding row's cache
			// reads are already inside that row's input, which the embedding meter
			// claims whole, so counting them again would inflate the total.
			cacheRead: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}) filter (where not (${embedding})), 0)::bigint`,
			cacheWrite: sql<number>`coalesce(sum(${auditLog.cacheWriteTokens}) filter (where not (${embedding})), 0)::bigint`,
			embeddingInput: sql<number>`coalesce(sum(${auditLog.inputTokens}) filter (where ${embedding}), 0)::bigint`,
			embeddingOutput: sql<number>`coalesce(sum(${auditLog.outputTokens}) filter (where ${embedding}), 0)::bigint`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			saved: sql<string>`coalesce(sum(${auditLog.savedUsd}), 0)::text`,
			savedInput: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			savedOutput: sql<number>`coalesce(sum(${auditLog.savedOutputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.where(and(...conds))
		.groupBy(auditLog.model);

	const prices = await listModelPrices();

	let input = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let output = 0;
	let embeddingTokens = 0;
	let costUsd = 0;
	let savedUsd = 0;
	let savedInputTokens = 0;
	let savedOutputTokens = 0;
	let providerCacheSavedUsd = 0;
	// list-price cost per meter, pre-scaling
	const listCost: Record<TokenMeter['key'], number> = {
		input: 0,
		cacheRead: 0,
		cacheWrite: 0,
		output: 0,
		embedding: 0
	};

	for (const r of rows) {
		const embIn = Number(r.embeddingInput ?? 0);
		const embOut = Number(r.embeddingOutput ?? 0);
		const read = Number(r.cacheRead ?? 0);
		const write = Number(r.cacheWrite ?? 0);
		// Fresh input is what's left of the prompt after the embedding, cache-read
		// and cache-write portions are carved out — the exact same subtraction the
		// gateway's own cost formula performs (`promptTokens - cacheRead -
		// cacheWrite`), so the meters partition the total the way the bill does.
		// Clamped at zero: the counts come from upstream independently, so a
		// malformed usage block could otherwise drive a meter negative.
		const freshInput = Math.max(0, Number(r.inputTokens ?? 0) - embIn - read - write);

		input += freshInput;
		cacheRead += read;
		cacheWrite += write;
		output += Math.max(0, Number(r.outputTokens ?? 0) - embOut);
		embeddingTokens += embIn + embOut;
		costUsd += Number(r.cost ?? 0);
		savedUsd += Number(r.saved ?? 0);
		savedInputTokens += Number(r.savedInput ?? 0);
		savedOutputTokens += Number(r.savedOutput ?? 0);

		const p = r.model ? resolveModelPrice(prices, r.model) : null;
		if (p) {
			// Default multipliers match the gateway's own fallbacks when a price row
			// leaves the cache rates NULL: 0.1x input to read, 1.25x to write.
			const readRate = p.cacheReadPerMtok ?? p.inputPerMtok * 0.1;
			const writeRate = p.cacheWritePerMtok ?? p.inputPerMtok * 1.25;
			const M = 1_000_000;
			listCost.input += (freshInput * p.inputPerMtok) / M;
			listCost.cacheRead += (read * readRate) / M;
			listCost.cacheWrite += (write * writeRate) / M;
			listCost.output += (Math.max(0, Number(r.outputTokens ?? 0) - embOut) * p.outputPerMtok) / M;
			listCost.embedding += (embIn * p.inputPerMtok + embOut * p.outputPerMtok) / M;
			if (read > 0) {
				providerCacheSavedUsd += (read * Math.max(0, p.inputPerMtok - readRate)) / M;
			}
		}
	}

	// Scale the list-price split onto the spend actually recorded, so the meter
	// costs sum to `costUsd` exactly. Falls back to the raw list figures when
	// there's nothing to scale against (no priced traffic, or a zero-cost window).
	const listTotal = Object.values(listCost).reduce((a, c) => a + c, 0);
	const scale = listTotal > 0 && costUsd > 0 ? costUsd / listTotal : listTotal > 0 ? 0 : 1;
	const meters: TokenMeter[] = [
		{ key: 'input', tokens: input, costUsd: listCost.input * scale },
		{ key: 'cacheRead', tokens: cacheRead, costUsd: listCost.cacheRead * scale },
		{ key: 'cacheWrite', tokens: cacheWrite, costUsd: listCost.cacheWrite * scale },
		{ key: 'output', tokens: output, costUsd: listCost.output * scale },
		{ key: 'embedding', tokens: embeddingTokens, costUsd: listCost.embedding * scale }
	];

	return {
		meters,
		totalTokens: meters.reduce((s, m) => s + m.tokens, 0),
		costUsd,
		savedUsd,
		savedInputTokens,
		savedOutputTokens,
		providerCacheSavedUsd
	};
}

/** The meters in display order — the same order the composition bar stacks in. */
const METER_ORDER: { key: TokenMeter['key']; label: string }[] = [
	{ key: 'input', label: 'Input (fresh)' },
	{ key: 'cacheRead', label: 'Input (cache read)' },
	{ key: 'cacheWrite', label: 'Input (cache write)' },
	{ key: 'output', label: 'Output' },
	{ key: 'embedding', label: 'Embeddings' }
];

/**
 * The token meters bucketed over time, shaped as a {@link GroupedSeriesResult}
 * so the cost-analysis stacked chart can render it unchanged — same tooltip,
 * axis and 100%-stacked mode, no second charting path to keep in step.
 *
 * Answers the question the single composition bar can't: whether the mix is
 * *moving*. A cache-read share climbing week over week is the thing an operator
 * is trying to engineer for, and a flat total can hide it entirely.
 *
 * Meters partition each bucket exactly, by the same subtraction
 * `orgTokenMeters` uses (and the gateway's own cost formula before it), so the
 * bars sum to that bucket's real token volume.
 */
export async function orgTokenMetersSeries(
	range: ResolvedRange,
	opts: {
		unit?: BucketChoice;
		filters?: UsageFilter[];
		serviceId?: string;
		tokenId?: string;
	} = {}
): Promise<GroupedSeriesResult> {
	const unit = resolveSeriesBucket(range, opts.unit ?? 'auto');
	const step = BUCKET_STEP[unit];
	const startIso = range.start.toISOString();
	const upperIso = (range.end ?? new Date()).toISOString();
	const emb = sql`${auditLog.model} ilike '%embedding%'`;
	const scope = sql.join(
		[
			...(opts.serviceId ? [sql`${auditLog.serviceId} = ${opts.serviceId}::uuid`] : []),
			...(opts.tokenId ? [sql`${auditLog.tokenId} = ${opts.tokenId}::uuid`] : [])
		].map((c) => sql` and ${c}`),
		sql``
	);

	// Grouped by (bucket, model): the model is needed to price each meter at its
	// own rate, exactly as orgTokenMeters does for the window as a whole. The
	// generate_series left join still pads empty buckets — they come back as a
	// single row with a null model and zero sums.
	const rows = await db.execute<{
		bucket: string;
		model: string | null;
		input: number;
		output: number;
		cache_read: number;
		cache_write: number;
		emb_in: number;
		emb_out: number;
		cost: string;
	}>(sql`
		select
			to_char(g.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket,
			${auditLog.model} as model,
			coalesce(sum(${auditLog.inputTokens}) filter (where not (${emb})), 0)::bigint as input,
			coalesce(sum(${auditLog.outputTokens}) filter (where not (${emb})), 0)::bigint as output,
			coalesce(sum(${auditLog.providerCachedTokens}) filter (where not (${emb})), 0)::bigint as cache_read,
			coalesce(sum(${auditLog.cacheWriteTokens}) filter (where not (${emb})), 0)::bigint as cache_write,
			coalesce(sum(${auditLog.inputTokens}) filter (where ${emb}), 0)::bigint as emb_in,
			coalesce(sum(${auditLog.outputTokens}) filter (where ${emb}), 0)::bigint as emb_out,
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost
		from generate_series(
			date_trunc(${unit}, ${startIso}::timestamp),
			date_trunc(${unit}, ${upperIso}::timestamp),
			${step}::interval
		) as g(bucket)
		left join ${auditLog}
			on date_trunc(${unit}, ${auditLog.createdAt}) = g.bucket
			and ${usageCondsSql(range, opts.filters)}${scope}
		group by g.bucket, ${auditLog.model}
		order by g.bucket asc
	`);

	const prices = await listModelPrices();
	const buckets: string[] = [];
	const idx = new Map<string, number>();
	type Cell = { tokens: number; list: number };
	const blank = (): Record<TokenMeter['key'], Cell> => ({
		input: { tokens: 0, list: 0 },
		cacheRead: { tokens: 0, list: 0 },
		cacheWrite: { tokens: 0, list: 0 },
		output: { tokens: 0, list: 0 },
		embedding: { tokens: 0, list: 0 }
	});
	const perBucket: Record<TokenMeter['key'], Cell>[] = [];
	const actualCost: number[] = [];

	for (const r of rows) {
		if (!idx.has(r.bucket)) {
			idx.set(r.bucket, buckets.length);
			buckets.push(r.bucket);
			perBucket.push(blank());
			actualCost.push(0);
		}
		const b = idx.get(r.bucket)!;
		const cell = perBucket[b];
		actualCost[b] += Number(r.cost ?? 0);

		const read = Number(r.cache_read ?? 0);
		const write = Number(r.cache_write ?? 0);
		const embIn = Number(r.emb_in ?? 0);
		const embOut = Number(r.emb_out ?? 0);
		// same partition as orgTokenMeters: cache read/write are subsets of prompt
		const fresh = Math.max(0, Number(r.input ?? 0) - read - write);
		const out = Number(r.output ?? 0);

		cell.input.tokens += fresh;
		cell.cacheRead.tokens += read;
		cell.cacheWrite.tokens += write;
		cell.output.tokens += out;
		cell.embedding.tokens += embIn + embOut;

		const p = r.model ? resolveModelPrice(prices, r.model) : null;
		if (p) {
			const M = 1_000_000;
			const readRate = p.cacheReadPerMtok ?? p.inputPerMtok * 0.1;
			const writeRate = p.cacheWritePerMtok ?? p.inputPerMtok * 1.25;
			cell.input.list += (fresh * p.inputPerMtok) / M;
			cell.cacheRead.list += (read * readRate) / M;
			cell.cacheWrite.list += (write * writeRate) / M;
			cell.output.list += (out * p.outputPerMtok) / M;
			cell.embedding.list += (embIn * p.inputPerMtok + embOut * p.outputPerMtok) / M;
		}
	}

	const series: GroupedSeries[] = METER_ORDER.map((m) => {
		const points = buckets.map((_, b) => {
			const cell = perBucket[b][m.key];
			// Scale the bucket's list-price split onto the spend actually recorded
			// there, so the stacked bars sum to that bucket's real cost.
			const listTotal = Object.values(perBucket[b]).reduce((a, c) => a + c.list, 0);
			const scale = listTotal > 0 && actualCost[b] > 0 ? actualCost[b] / listTotal : 0;
			return { requests: 0, denied: 0, costUsd: cell.list * scale, tokens: cell.tokens };
		});
		return {
			key: m.key,
			label: m.label,
			hint: null,
			points,
			costUsd: points.reduce((a, c) => a + c.costUsd, 0),
			requests: 0,
			tokens: points.reduce((a, c) => a + c.tokens, 0)
		};
	}).filter((x) => x.tokens > 0);

	return { unit, buckets, series, hasOthers: false };
}

/** Price row shape the meter costing needs. */
interface ResolvedPrice {
	model: string;
	inputPerMtok: number;
	outputPerMtok: number;
	cacheReadPerMtok: number | null;
	cacheWritePerMtok: number | null;
}

/**
 * All price rows, instance overrides shadowing the platform defaults for the
 * same model. Read once per meter query rather than joined per row — the table
 * is small (hundreds of rows at most) and this keeps the aggregate query simple.
 */
async function listModelPrices(): Promise<ResolvedPrice[]> {
	const rows = await db
		.select({
			model: modelPrice.model,
			isDefault: modelPrice.isDefault,
			inputPerMtok: modelPrice.inputPerMtok,
			outputPerMtok: modelPrice.outputPerMtok,
			cacheReadPerMtok: modelPrice.cacheReadPerMtok,
			cacheWritePerMtok: modelPrice.cacheWritePerMtok
		})
		.from(modelPrice);

	const byModel = new Map<string, ResolvedPrice>();
	// custom rows win, so apply defaults first and let overrides replace them
	for (const r of [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))) {
		byModel.set(r.model.toLowerCase(), {
			model: r.model.toLowerCase(),
			inputPerMtok: Number(r.inputPerMtok ?? 0),
			outputPerMtok: Number(r.outputPerMtok ?? 0),
			cacheReadPerMtok: r.cacheReadPerMtok == null ? null : Number(r.cacheReadPerMtok),
			cacheWritePerMtok: r.cacheWritePerMtok == null ? null : Number(r.cacheWritePerMtok)
		});
	}
	return [...byModel.values()];
}

/** Longest-prefix match, mirroring how the gateway prices a request. */
function resolveModelPrice(prices: ResolvedPrice[], model: string): ResolvedPrice | null {
	const key = model.toLowerCase();
	let best: ResolvedPrice | null = null;
	for (const p of prices) {
		if (key === p.model) return p;
		if (key.startsWith(p.model) && (!best || p.model.length > best.model.length)) best = p;
	}
	return best;
}

export interface UsageTotals {
	requests: number;
	costUsd: number;
	/** requests the upstream/gateway answered with an error status */
	errors: number;
	/** requests blocked by policy/budget before reaching upstream */
	denied: number;
	/** median upstream latency in ms over the window, or null when unmeasured */
	latencyP50: number | null;
	/** 95th-percentile upstream latency in ms, or null when unmeasured */
	latencyP95: number | null;
	inputTokens: number;
	outputTokens: number;
	savedInputTokens: number;
	providerCachedTokens: number;
	/** subset of input/output tokens attributable to embedding models */
	embeddingInputTokens: number;
	embeddingOutputTokens: number;
}

/**
 * Headline aggregates for the whole org (or one service, with `serviceId`) over
 * the window — the single source for the token/cost cards. Computed in one query
 * rather than summing a breakdown so the figures are exact even past the top-N
 * row limits. The embedding subset is broken out so the page can offer a toggle
 * to exclude high-volume, low-cost embedding tokens from the headline.
 */
export async function orgUsageTotals(
	range: ResolvedRange,
	opts: { serviceId?: string; tokenId?: string; filters?: UsageFilter[] } = {}
): Promise<UsageTotals> {
	const embedding = sql`${auditLog.model} ilike '%embedding%'`;
	const [row] = await db
		.select({
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			errors: sql<number>`(count(*) filter (where ${auditLog.status} = 'error'))::int`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			// percentiles over the rows that actually recorded a latency (cache hits
			// and denials don't), so the figure reflects real upstream round-trips
			latencyP50: sql<
				number | null
			>`percentile_cont(0.5) within group (order by ${auditLog.latencyMs})`,
			latencyP95: sql<
				number | null
			>`percentile_cont(0.95) within group (order by ${auditLog.latencyMs})`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			savedInputTokens: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			providerCachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)::bigint`,
			embeddingInputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}) filter (where ${embedding}), 0)::bigint`,
			embeddingOutputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}) filter (where ${embedding}), 0)::bigint`
		})
		.from(auditLog)
		.where(and(...usageConds(range, opts.serviceId, opts.tokenId, opts.filters)));

	return {
		requests: Number(row?.requests ?? 0),
		costUsd: Number(row?.cost ?? 0),
		errors: Number(row?.errors ?? 0),
		denied: Number(row?.denied ?? 0),
		latencyP50: row?.latencyP50 == null ? null : Math.round(Number(row.latencyP50)),
		latencyP95: row?.latencyP95 == null ? null : Math.round(Number(row.latencyP95)),
		inputTokens: Number(row?.inputTokens ?? 0),
		outputTokens: Number(row?.outputTokens ?? 0),
		savedInputTokens: Number(row?.savedInputTokens ?? 0),
		providerCachedTokens: Number(row?.providerCachedTokens ?? 0),
		embeddingInputTokens: Number(row?.embeddingInputTokens ?? 0),
		embeddingOutputTokens: Number(row?.embeddingOutputTokens ?? 0)
	};
}

/**
 * Current spend standing for every service whose policy sets a daily or monthly
 * ceiling — the input to the budget soft-warnings on the overview and usage
 * pages. Windows are the same fixed UTC calendar buckets the gateway enforces
 * against (see budget.ts): "daily" since 00:00 UTC, "monthly" since the 1st. The
 * day/month boundaries are computed here and passed as parameters so this read
 * matches enforcement exactly. Only services actually carrying a ceiling are
 * returned; classifying warn/over from these numbers is left to `budgetWarnings`.
 */
export async function orgBudgetStatus(): Promise<BudgetStatus[]> {
	const now = new Date();
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

	// Built with the query builder rather than a raw `db.execute`: that's the only
	// path that binds a Date parameter through the column's type mapping (the same
	// `gte(createdAt, …)` the gateway enforces with — see budget.ts). A raw `sql`
	// template can't serialize a Date on its own and throws at execution. The left
	// join is scoped to the month window (the wider of the two); the daily figure
	// is a narrower filtered aggregate within those rows.
	const rows = await db
		.select({
			serviceId: service.id,
			serviceName: service.name,
			policyName: policy.name,
			dailyBudget: policy.dailyBudgetUsd,
			monthlyBudget: policy.monthlyBudgetUsd,
			dailySpent: sql<string>`coalesce(sum(${auditLog.costUsd}) filter (where ${gte(auditLog.createdAt, dayStart)}), 0)`,
			monthlySpent: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`
		})
		.from(service)
		.innerJoin(policy, eq(policy.id, service.policyId))
		.leftJoin(
			auditLog,
			and(
				eq(auditLog.serviceId, service.id),
				sql`${auditLog.action} like 'gateway.%'`,
				gte(auditLog.createdAt, monthStart)
			)
		)
		.where(
			and(
				isNull(service.deletedAt),
				sql`(${policy.dailyBudgetUsd} > 0 or ${policy.monthlyBudgetUsd} > 0)`
			)
		)
		.groupBy(service.id, service.name, policy.name, policy.dailyBudgetUsd, policy.monthlyBudgetUsd);

	return rows.map((r) => {
		const dailyBudget = Number(r.dailyBudget ?? 0);
		const monthlyBudget = Number(r.monthlyBudget ?? 0);
		return {
			serviceId: r.serviceId,
			serviceName: r.serviceName,
			policyName: r.policyName,
			daily:
				dailyBudget > 0 ? { budgetUsd: dailyBudget, spentUsd: Number(r.dailySpent ?? 0) } : null,
			monthly:
				monthlyBudget > 0
					? { budgetUsd: monthlyBudget, spentUsd: Number(r.monthlySpent ?? 0) }
					: null
		};
	});
}

/**
 * The instance-wide spend ceiling and how close the org is to it this period.
 * Returns a single BudgetStatus (scope id 'instance') so it renders through the
 * same gauge/alert as services, or null when no instance budget is configured.
 * Spend is summed across ALL gateway traffic — matching what budget.ts enforces
 * for the 'instance' scope, not filtered per service.
 */
export async function instanceBudgetStatus(): Promise<BudgetStatus | null> {
	const settings = await getSettings();
	const dailyBudget = settings.dailyBudgetUsd ?? 0;
	const monthlyBudget = settings.monthlyBudgetUsd ?? 0;
	if (dailyBudget <= 0 && monthlyBudget <= 0) return null;

	const now = new Date();
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

	const [row] = await db
		.select({
			dailySpent: sql<string>`coalesce(sum(${auditLog.costUsd}) filter (where ${gte(auditLog.createdAt, dayStart)}), 0)`,
			monthlySpent: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`
		})
		.from(auditLog)
		.where(gte(auditLog.createdAt, monthStart));

	return {
		serviceId: 'instance',
		serviceName: 'Instance',
		policyName: 'all services',
		daily:
			dailyBudget > 0 ? { budgetUsd: dailyBudget, spentUsd: Number(row?.dailySpent ?? 0) } : null,
		monthly:
			monthlyBudget > 0
				? { budgetUsd: monthlyBudget, spentUsd: Number(row?.monthlySpent ?? 0) }
				: null
	};
}
