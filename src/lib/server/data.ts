import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	service,
	machineToken,
	providerSecret,
	policy,
	auditLog,
	orgSettings
} from '$lib/server/db/schema';
import { encrypt } from '$lib/server/crypto';
import { issueToken } from '$lib/server/tokens';
import { audit } from '$lib/server/audit';

/* ----------------------------------- services ----------------------------------- */

export function listServices(orgId: string) {
	return db
		.select()
		.from(service)
		.where(eq(service.organizationId, orgId))
		.orderBy(desc(service.createdAt));
}

export async function createService(
	orgId: string,
	input: { name: string; type?: string; description?: string; policyId?: string | null }
) {
	const [row] = await db
		.insert(service)
		.values({
			organizationId: orgId,
			name: input.name,
			type: input.type || 'app',
			description: input.description || null,
			policyId: input.policyId || null
		})
		.returning();
	return row;
}

export async function updateService(
	orgId: string,
	id: string,
	patch: { name?: string; type?: string; description?: string | null; policyId?: string | null }
) {
	const [row] = await db
		.update(service)
		.set(patch)
		.where(and(eq(service.id, id), eq(service.organizationId, orgId)))
		.returning();
	return row ?? null;
}

export async function deleteService(orgId: string, id: string) {
	await db.delete(service).where(and(eq(service.id, id), eq(service.organizationId, orgId)));
}

/* ------------------------------------ tokens ------------------------------------ */

export function listTokens(orgId: string) {
	return db
		.select({
			id: machineToken.id,
			name: machineToken.name,
			display: machineToken.display,
			scopes: machineToken.scopes,
			serviceId: machineToken.serviceId,
			serviceName: service.name,
			lastUsedAt: machineToken.lastUsedAt,
			expiresAt: machineToken.expiresAt,
			revokedAt: machineToken.revokedAt,
			createdAt: machineToken.createdAt
		})
		.from(machineToken)
		.innerJoin(service, eq(service.id, machineToken.serviceId))
		.where(eq(machineToken.organizationId, orgId))
		.orderBy(desc(machineToken.createdAt));
}

/**
 * Create a machine token. Returns the row plus the one-time plaintext secret
 * which is NOT stored anywhere — surface it to the user immediately.
 */
export async function createToken(
	orgId: string,
	userId: string,
	input: { serviceId: string; name: string; scopes?: string[]; expiresAt?: Date | null }
) {
	// ensure the service belongs to this org
	const [svc] = await db
		.select()
		.from(service)
		.where(and(eq(service.id, input.serviceId), eq(service.organizationId, orgId)))
		.limit(1);
	if (!svc) throw new Error('Service not found');

	const issued = issueToken();
	const [row] = await db
		.insert(machineToken)
		.values({
			organizationId: orgId,
			serviceId: input.serviceId,
			name: input.name,
			display: issued.display,
			hashedToken: issued.hashedToken,
			scopes: input.scopes ?? [],
			expiresAt: input.expiresAt ?? null,
			createdByUserId: userId
		})
		.returning();

	await audit({
		organizationId: orgId,
		action: 'token.create',
		status: 'ok',
		serviceId: input.serviceId,
		tokenId: row.id,
		detail: input.name
	});

	return { token: row, plaintext: issued.plaintext };
}

export async function revokeToken(orgId: string, id: string) {
	const [row] = await db
		.update(machineToken)
		.set({ revokedAt: new Date() })
		.where(and(eq(machineToken.id, id), eq(machineToken.organizationId, orgId)))
		.returning();
	if (row) {
		await audit({
			organizationId: orgId,
			action: 'token.revoke',
			status: 'ok',
			serviceId: row.serviceId,
			tokenId: row.id,
			detail: row.name
		});
	}
	return row ?? null;
}

/* ------------------------------- provider secrets ------------------------------- */

export function listProviderSecrets(orgId: string) {
	return db
		.select({
			id: providerSecret.id,
			provider: providerSecret.provider,
			label: providerSecret.label,
			hint: providerSecret.hint,
			createdAt: providerSecret.createdAt,
			updatedAt: providerSecret.updatedAt
		})
		.from(providerSecret)
		.where(eq(providerSecret.organizationId, orgId))
		.orderBy(providerSecret.provider);
}

export async function upsertProviderSecret(
	orgId: string,
	userId: string,
	input: { provider: string; secret: string; label?: string }
) {
	const hint = input.secret.slice(-4);
	const [row] = await db
		.insert(providerSecret)
		.values({
			organizationId: orgId,
			provider: input.provider,
			label: input.label || null,
			encryptedSecret: encrypt(input.secret),
			hint,
			createdByUserId: userId
		})
		.onConflictDoUpdate({
			target: [providerSecret.organizationId, providerSecret.provider],
			set: {
				label: input.label || null,
				encryptedSecret: encrypt(input.secret),
				hint,
				updatedAt: new Date()
			}
		})
		.returning({ id: providerSecret.id, provider: providerSecret.provider });

	await audit({
		organizationId: orgId,
		action: 'provider.upsert',
		status: 'ok',
		provider: input.provider,
		detail: input.provider
	});
	return row;
}

export async function deleteProviderSecret(orgId: string, id: string) {
	await db
		.delete(providerSecret)
		.where(and(eq(providerSecret.id, id), eq(providerSecret.organizationId, orgId)));
}

/* ----------------------------------- policies ----------------------------------- */

export function listPolicies(orgId: string) {
	return db
		.select()
		.from(policy)
		.where(eq(policy.organizationId, orgId))
		.orderBy(desc(policy.createdAt));
}

export async function createPolicy(
	orgId: string,
	input: {
		name: string;
		allowedProviders?: string[];
		allowedModels?: string[];
		rateLimitPerMinute?: number;
		dailyBudgetUsd?: number;
		monthlyBudgetUsd?: number;
		// null = inherit org default, 0 = off, >0 = override
		cacheTtlSeconds?: number | null;
	}
) {
	const [row] = await db
		.insert(policy)
		.values({
			organizationId: orgId,
			name: input.name,
			allowedProviders: input.allowedProviders ?? [],
			allowedModels: input.allowedModels ?? [],
			rateLimitPerMinute: input.rateLimitPerMinute ?? 0,
			dailyBudgetUsd: String(input.dailyBudgetUsd ?? 0),
			monthlyBudgetUsd: String(input.monthlyBudgetUsd ?? 0),
			cacheTtlSeconds: input.cacheTtlSeconds ?? null
		})
		.returning();
	return row;
}

export async function updatePolicy(
	orgId: string,
	id: string,
	patch: {
		name?: string;
		allowedProviders?: string[];
		allowedModels?: string[];
		rateLimitPerMinute?: number;
		dailyBudgetUsd?: number;
		monthlyBudgetUsd?: number;
		cacheTtlSeconds?: number | null;
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
		.where(and(eq(policy.id, id), eq(policy.organizationId, orgId)))
		.returning();
	return row ?? null;
}

export async function deletePolicy(orgId: string, id: string) {
	await db.delete(policy).where(and(eq(policy.id, id), eq(policy.organizationId, orgId)));
}

/* -------------------------------- org settings ---------------------------------- */

/** Read an org's settings, falling back to defaults when no row exists yet. */
export async function getOrgSettings(orgId: string): Promise<{ cacheTtlSeconds: number }> {
	const [row] = await db
		.select()
		.from(orgSettings)
		.where(eq(orgSettings.organizationId, orgId))
		.limit(1);
	return { cacheTtlSeconds: row?.cacheTtlSeconds ?? 0 };
}

/** Upsert an org's gateway settings. */
export async function updateOrgSettings(orgId: string, input: { cacheTtlSeconds: number }) {
	const cacheTtlSeconds = Math.max(0, Math.floor(input.cacheTtlSeconds) || 0);
	await db
		.insert(orgSettings)
		.values({ organizationId: orgId, cacheTtlSeconds })
		.onConflictDoUpdate({
			target: orgSettings.organizationId,
			set: { cacheTtlSeconds }
		});
}

/* ------------------------------------ audit ------------------------------------- */

export function listAudit(orgId: string, limit = 100) {
	return db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			status: auditLog.status,
			provider: auditLog.provider,
			model: auditLog.model,
			statusCode: auditLog.statusCode,
			costUsd: auditLog.costUsd,
			latencyMs: auditLog.latencyMs,
			ip: auditLog.ip,
			detail: auditLog.detail,
			serviceName: service.name,
			createdAt: auditLog.createdAt
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.where(eq(auditLog.organizationId, orgId))
		.orderBy(desc(auditLog.createdAt))
		.limit(limit);
}

/** Aggregate dashboard stats for the overview page. */
export async function orgStats(orgId: string) {
	const [counts] = await db
		.select({
			services: sql<number>`count(distinct ${service.id})`
		})
		.from(service)
		.where(eq(service.organizationId, orgId));

	const [tokenCount] = await db
		.select({ active: sql<number>`count(*) filter (where ${machineToken.revokedAt} is null)` })
		.from(machineToken)
		.where(eq(machineToken.organizationId, orgId));

	const [reqs] = await db
		.select({
			total: sql<number>`count(*)`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`,
			denied: sql<number>`count(*) filter (where ${auditLog.status} = 'deny')`,
			// cache hits log detail 'cache hit' / 'cache hit (stream)' at cost 0
			cacheHits: sql<number>`count(*) filter (where ${auditLog.detail} like 'cache hit%')`,
			// exact savings: each hit recorded the cached entry's original cost
			cacheSaved: sql<string>`coalesce(sum(${auditLog.savedUsd}), 0)`
		})
		.from(auditLog)
		.where(and(eq(auditLog.organizationId, orgId), sql`${auditLog.action} like 'gateway.%'`));

	const cacheHits = Number(reqs?.cacheHits ?? 0);
	const total = Number(reqs?.total ?? 0);

	return {
		services: Number(counts?.services ?? 0),
		activeTokens: Number(tokenCount?.active ?? 0),
		requests: total,
		denied: Number(reqs?.denied ?? 0),
		costUsd: Number(reqs?.cost ?? 0),
		cacheHits,
		// share of all gateway requests served from cache (0–1)
		cacheHitRate: total > 0 ? cacheHits / total : 0,
		// exact: sum of each hit's recorded saved amount
		cacheSavedUsd: Number(reqs?.cacheSaved ?? 0)
	};
}
