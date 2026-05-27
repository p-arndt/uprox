import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
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
import type { BudgetStatus } from '$lib/budget';

/* ----------------------------------- services ----------------------------------- */

export function listServices(orgId: string) {
	return db
		.select()
		.from(service)
		.where(and(eq(service.organizationId, orgId), isNull(service.deletedAt)))
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
		.where(and(eq(service.id, id), eq(service.organizationId, orgId), isNull(service.deletedAt)))
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
export async function deleteService(orgId: string, id: string) {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.update(service)
			.set({ deletedAt: new Date() })
			.where(and(eq(service.id, id), eq(service.organizationId, orgId), isNull(service.deletedAt)))
			.returning({ id: service.id });
		if (!row) return;
		await tx
			.update(machineToken)
			.set({ revokedAt: new Date() })
			.where(and(eq(machineToken.serviceId, id), isNull(machineToken.revokedAt)));
	});
}

/* ------------------------------------ tokens ------------------------------------ */

export function listTokens(orgId: string) {
	return (
		db
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
			// hide tokens belonging to retired (soft-deleted) services
			.where(and(eq(machineToken.organizationId, orgId), isNull(service.deletedAt)))
			.orderBy(desc(machineToken.createdAt))
	);
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
	// ensure the service belongs to this org and isn't retired
	const [svc] = await db
		.select()
		.from(service)
		.where(
			and(
				eq(service.id, input.serviceId),
				eq(service.organizationId, orgId),
				isNull(service.deletedAt)
			)
		)
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
			baseUrl: providerSecret.baseUrl,
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
	input: { provider: string; secret: string; label?: string; baseUrl?: string }
) {
	const hint = input.secret.slice(-4);
	const baseUrl = input.baseUrl?.trim() || null;
	const [row] = await db
		.insert(providerSecret)
		.values({
			organizationId: orgId,
			provider: input.provider,
			label: input.label || null,
			baseUrl,
			encryptedSecret: encrypt(input.secret),
			hint,
			createdByUserId: userId
		})
		.onConflictDoUpdate({
			target: [providerSecret.organizationId, providerSecret.provider],
			set: {
				label: input.label || null,
				baseUrl,
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

export async function updateProviderSecret(
	orgId: string,
	id: string,
	input: { label?: string | null; baseUrl?: string | null }
) {
	const [row] = await db
		.update(providerSecret)
		.set({
			label: input.label ?? null,
			baseUrl: input.baseUrl?.trim() || null,
			updatedAt: new Date()
		})
		.where(and(eq(providerSecret.id, id), eq(providerSecret.organizationId, orgId)))
		.returning({ id: providerSecret.id, provider: providerSecret.provider });
	if (row) {
		await audit({
			organizationId: orgId,
			action: 'provider.update',
			status: 'ok',
			provider: row.provider,
			detail: row.provider
		});
	}
	return row ?? null;
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
		// "openai" | "azure" | null — preferred backend for the shared model namespace
		preferredProvider?: string | null;
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
			preferredProvider: input.preferredProvider ?? null,
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
		preferredProvider?: string | null;
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

export interface OrgSettings {
	cacheTtlSeconds: number;
	membersCanManageTokens: boolean;
	membersCanManageServices: boolean;
}

/** Read an org's settings, falling back to defaults when no row exists yet. */
export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
	const [row] = await db
		.select()
		.from(orgSettings)
		.where(eq(orgSettings.organizationId, orgId))
		.limit(1);
	return {
		cacheTtlSeconds: row?.cacheTtlSeconds ?? 0,
		membersCanManageTokens: row?.membersCanManageTokens ?? false,
		membersCanManageServices: row?.membersCanManageServices ?? false
	};
}

/**
 * Upsert an org's gateway settings. Only the fields present in `input` are
 * written, so callers can update the cache TTL and the member-permission
 * toggles independently.
 */
export async function updateOrgSettings(orgId: string, input: Partial<OrgSettings>) {
	const set: Partial<typeof orgSettings.$inferInsert> = {};
	if (input.cacheTtlSeconds !== undefined) {
		set.cacheTtlSeconds = Math.max(0, Math.floor(input.cacheTtlSeconds) || 0);
	}
	if (input.membersCanManageTokens !== undefined) {
		set.membersCanManageTokens = input.membersCanManageTokens;
	}
	if (input.membersCanManageServices !== undefined) {
		set.membersCanManageServices = input.membersCanManageServices;
	}
	await db
		.insert(orgSettings)
		.values({ organizationId: orgId, ...set })
		.onConflictDoUpdate({
			target: orgSettings.organizationId,
			set
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
			providerCachedTokens: auditLog.providerCachedTokens,
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
		.where(and(eq(service.organizationId, orgId), isNull(service.deletedAt)));

	const [tokenCount] = await db
		.select({ active: sql<number>`count(*) filter (where ${machineToken.revokedAt} is null)` })
		.from(machineToken)
		.where(eq(machineToken.organizationId, orgId));

	const [providerCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(providerSecret)
		.where(eq(providerSecret.organizationId, orgId));

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
			providerCachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)`
		})
		.from(auditLog)
		.where(and(eq(auditLog.organizationId, orgId), sql`${auditLog.action} like 'gateway.%'`));

	const cacheHits = Number(reqs?.cacheHits ?? 0);
	const total = Number(reqs?.total ?? 0);

	return {
		services: Number(counts?.services ?? 0),
		providers: Number(providerCount?.count ?? 0),
		activeTokens: Number(tokenCount?.active ?? 0),
		requests: total,
		denied: Number(reqs?.denied ?? 0),
		costUsd: Number(reqs?.cost ?? 0),
		cacheHits,
		// share of all gateway requests served from cache (0–1)
		cacheHitRate: total > 0 ? cacheHits / total : 0,
		// exact: sum of each hit's recorded saved amount
		cacheSavedUsd: Number(reqs?.cacheSaved ?? 0),
		// total input tokens upstream providers served from their own prompt cache
		providerCachedTokens: Number(reqs?.providerCachedTokens ?? 0)
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
export async function orgDailyStats(orgId: string, days = 14): Promise<DailyStat[]> {
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
			and ${auditLog.organizationId} = ${orgId}
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

/* ----------------------------------- usage -------------------------------------- */

/** Start of `days`-day rolling window for the usage breakdowns. */
function windowStart(days: number): Date {
	return new Date(Date.now() - Math.max(1, days) * 86_400_000);
}

export interface ModelUsage {
	model: string;
	provider: string | null;
	requests: number;
	costUsd: number;
	denied: number;
}

/**
 * Gateway traffic grouped by model over the last `days` days, busiest first.
 * Powers the "usage by model" breakdown on the usage page.
 */
export async function orgUsageByModel(orgId: string, days = 30, limit = 50): Promise<ModelUsage[]> {
	const rows = await db
		.select({
			model: auditLog.model,
			// a model is served by a single provider; max() picks a stable non-null id
			provider: sql<string | null>`max(${auditLog.provider})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`
		})
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, orgId),
				sql`${auditLog.action} like 'gateway.%'`,
				sql`${auditLog.model} is not null`,
				gte(auditLog.createdAt, windowStart(days))
			)
		)
		.groupBy(auditLog.model)
		.orderBy(desc(sql`count(*)`))
		.limit(limit);

	return rows.map((r) => ({
		model: r.model as string,
		provider: r.provider,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0)
	}));
}

export interface ServiceUsage {
	serviceId: string | null;
	serviceName: string | null;
	requests: number;
	costUsd: number;
	denied: number;
}

/**
 * Gateway traffic grouped by the calling service over the last `days` days,
 * busiest first. Requests whose service was since deleted group under a null id.
 */
export async function orgUsageByService(orgId: string, days = 30): Promise<ServiceUsage[]> {
	const rows = await db
		.select({
			serviceId: auditLog.serviceId,
			serviceName: sql<string | null>`max(${service.name})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.where(
			and(
				eq(auditLog.organizationId, orgId),
				sql`${auditLog.action} like 'gateway.%'`,
				gte(auditLog.createdAt, windowStart(days))
			)
		)
		.groupBy(auditLog.serviceId)
		.orderBy(desc(sql`count(*)`));

	return rows.map((r) => ({
		serviceId: r.serviceId,
		serviceName: r.serviceName,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0)
	}));
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
export async function orgBudgetStatus(orgId: string): Promise<BudgetStatus[]> {
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
				eq(service.organizationId, orgId),
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
