import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	service,
	machineToken,
	providerSecret,
	policy,
	auditLog,
	settings
} from '$lib/server/db/schema';
import { encrypt } from '$lib/server/crypto';
import { issueToken } from '$lib/server/tokens';
import { audit } from '$lib/server/audit';
import type { BudgetStatus } from '$lib/budget';

/* ----------------------------------- services ----------------------------------- */

export function listServices() {
	return db
		.select()
		.from(service)
		.where(isNull(service.deletedAt))
		.orderBy(desc(service.createdAt));
}

export async function createService(input: {
	name: string;
	type?: string;
	description?: string;
	policyId?: string | null;
}) {
	const [row] = await db
		.insert(service)
		.values({
			name: input.name,
			type: input.type || 'app',
			description: input.description || null,
			policyId: input.policyId || null
		})
		.returning();
	return row;
}

export async function updateService(
	id: string,
	patch: { name?: string; type?: string; description?: string | null; policyId?: string | null }
) {
	const [row] = await db
		.update(service)
		.set(patch)
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

/* ------------------------------------ tokens ------------------------------------ */

export function listTokens() {
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
	input: { serviceId: string; name: string; scopes?: string[]; expiresAt?: Date | null }
) {
	// ensure the service exists and isn't retired
	const [svc] = await db
		.select()
		.from(service)
		.where(and(eq(service.id, input.serviceId), isNull(service.deletedAt)))
		.limit(1);
	if (!svc) throw new Error('Service not found');

	const issued = issueToken();
	const [row] = await db
		.insert(machineToken)
		.values({
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
		action: 'token.create',
		status: 'ok',
		serviceId: input.serviceId,
		tokenId: row.id,
		detail: input.name
	});

	return { token: row, plaintext: issued.plaintext };
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

/* ------------------------------- provider secrets ------------------------------- */

export function listProviderSecrets() {
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
		.orderBy(providerSecret.provider);
}

export async function upsertProviderSecret(
	userId: string,
	input: { provider: string; secret: string; label?: string; baseUrl?: string }
) {
	const hint = input.secret.slice(-4);
	const baseUrl = input.baseUrl?.trim() || null;
	const [row] = await db
		.insert(providerSecret)
		.values({
			provider: input.provider,
			label: input.label || null,
			baseUrl,
			encryptedSecret: encrypt(input.secret),
			hint,
			createdByUserId: userId
		})
		.onConflictDoUpdate({
			target: providerSecret.provider,
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
		action: 'provider.upsert',
		status: 'ok',
		provider: input.provider,
		detail: input.provider
	});
	return row;
}

export async function updateProviderSecret(
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
		.where(eq(providerSecret.id, id))
		.returning({ id: providerSecret.id, provider: providerSecret.provider });
	if (row) {
		await audit({
			action: 'provider.update',
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
			cacheTtlSeconds: input.cacheTtlSeconds ?? null
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
	budgetAlertsEnabled: boolean;
	budgetAlertThresholdPct: number;
	budgetAlertEmail: string | null;
}

/** Read instance settings, falling back to defaults when no row exists yet. */
export async function getSettings(): Promise<Settings> {
	const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
	return {
		cacheTtlSeconds: row?.cacheTtlSeconds ?? 0,
		membersCanManageTokens: row?.membersCanManageTokens ?? false,
		membersCanManageServices: row?.membersCanManageServices ?? false,
		budgetAlertsEnabled: row?.budgetAlertsEnabled ?? false,
		budgetAlertThresholdPct: row?.budgetAlertThresholdPct ?? 80,
		budgetAlertEmail: row?.budgetAlertEmail ?? null
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
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.where(sql`${auditLog.action} like 'gateway.%'`);

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
		providerCachedTokens: Number(reqs?.providerCachedTokens ?? 0),
		inputTokens: Number(reqs?.inputTokens ?? 0),
		outputTokens: Number(reqs?.outputTokens ?? 0)
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
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic grouped by model over the last `days` days, busiest first.
 * Powers the "usage by model" breakdown on the usage page.
 */
export async function orgUsageByModel(days = 30, limit = 50): Promise<ModelUsage[]> {
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
			and(
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
}

/**
 * Gateway traffic grouped by the calling service over the last `days` days,
 * busiest first. Requests whose service was since deleted group under a null id.
 */
export async function orgUsageByService(days = 30): Promise<ServiceUsage[]> {
	const rows = await db
		.select({
			serviceId: auditLog.serviceId,
			serviceName: sql<string | null>`max(${service.name})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.where(
			and(sql`${auditLog.action} like 'gateway.%'`, gte(auditLog.createdAt, windowStart(days)))
		)
		.groupBy(auditLog.serviceId)
		.orderBy(desc(sql`count(*)`));

	return rows.map((r) => ({
		serviceId: r.serviceId,
		serviceName: r.serviceName,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0)
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
 * Gateway traffic grouped by the calling machine token over the last `days`
 * days, busiest first. Lets operators see which individual API key is driving
 * spend (a service can carry multiple tokens; a leaked one would stand out
 * here long before the per-service total looks unusual). Revoked tokens are
 * still surfaced so historical activity remains attributable.
 */
export async function orgUsageByToken(days = 30, limit = 50): Promise<TokenUsage[]> {
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
		.where(
			and(
				sql`${auditLog.action} like 'gateway.%'`,
				sql`${auditLog.tokenId} is not null`,
				gte(auditLog.createdAt, windowStart(days))
			)
		)
		.groupBy(auditLog.tokenId)
		.orderBy(desc(sql`count(*)`))
		.limit(limit);

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
