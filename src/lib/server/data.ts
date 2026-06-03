import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
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
import type { ResolvedRange } from '$lib/usage-range';

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
	providerSecretId?: string | null;
}) {
	const [row] = await db
		.insert(service)
		.values({
			name: input.name,
			type: input.type || 'app',
			description: input.description || null,
			policyId: input.policyId || null,
			providerSecretId: input.providerSecretId || null
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
	}
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
				// the token's own policy (overrides the service policy when set)
				policyId: machineToken.policyId,
				policyName: policy.name,
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
		serviceId: string;
		name: string;
		scopes?: string[];
		// per-token model allowlist (narrows the policy); empty = no extra restriction
		allowedModels?: string[];
		// per-token policy that replaces the service policy; null = inherit service
		policyId?: string | null;
		expiresAt?: Date | null;
	}
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
			allowedModels: input.allowedModels ?? [],
			policyId: input.policyId ?? null,
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
		scopes?: string[];
		allowedModels?: string[];
		policyId?: string | null;
	}
) {
	const set: Partial<typeof machineToken.$inferInsert> = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.scopes !== undefined) set.scopes = patch.scopes;
	if (patch.allowedModels !== undefined) set.allowedModels = patch.allowedModels;
	if (patch.policyId !== undefined) set.policyId = patch.policyId;
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
 * rotating the key (pass `secret` to rotate; the hint follows it).
 */
export async function updateProviderSecret(
	id: string,
	input: { label?: string | null; baseUrl?: string | null; priority?: number; secret?: string }
) {
	const set: Partial<typeof providerSecret.$inferInsert> = { updatedAt: new Date() };
	if (input.label !== undefined) set.label = input.label || null;
	if (input.baseUrl !== undefined) set.baseUrl = input.baseUrl?.trim() || null;
	if (input.priority !== undefined) set.priority = input.priority;
	if (input.secret) {
		set.encryptedSecret = encrypt(input.secret);
		set.hint = input.secret.slice(-4);
	}
	const [row] = await db
		.update(providerSecret)
		.set(set)
		.where(eq(providerSecret.id, id))
		.returning({ id: providerSecret.id, provider: providerSecret.provider });
	if (row) {
		await audit({
			action: input.secret ? 'provider.rotate' : 'provider.update',
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
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			// tokens uprox's response cache saved this window — replayed from the
			// stored miss totals on every hit. Folded into the token-based cache
			// rate so the headline reflects both layers of caching.
			savedInputTokens: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			savedOutputTokens: sql<number>`coalesce(sum(${auditLog.savedOutputTokens}), 0)::bigint`
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

	// Token-based cache rate combines both layers:
	//  - uprox's response cache (savedInputTokens) skips upstream entirely
	//  - the provider's own prompt cache (providerCachedTokens) discounts a
	//    subset of the inputTokens that *did* go upstream
	// Denominator is total prompt volume the gateway has been asked to process —
	// "served upstream" + "served from uprox cache" — so the rate answers
	// "what fraction of input tokens benefited from caching?".
	const cacheableInputTokens = inputTokens + savedInputTokens;
	const cachedInputTokens = providerCachedTokens + savedInputTokens;
	const tokenCacheRate = cacheableInputTokens > 0 ? cachedInputTokens / cacheableInputTokens : 0;

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

/* ----------------------------------- usage -------------------------------------- */

/**
 * The shared filter for the usage breakdowns: gateway traffic inside a resolved
 * time window, optionally narrowed to one service. Rolling windows carry no
 * `end`; calendar buckets bound the upper edge exclusively. Pass the result to
 * `and(...)` — `undefined` legs are ignored by drizzle.
 */
function usageConds(range: ResolvedRange, serviceId?: string) {
	return [
		sql`${auditLog.action} like 'gateway.%'`,
		gte(auditLog.createdAt, range.start),
		range.end ? lt(auditLog.createdAt, range.end) : undefined,
		serviceId ? eq(auditLog.serviceId, serviceId) : undefined
	];
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
	opts: { serviceId?: string; limit?: number } = {}
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
		.where(and(sql`${auditLog.model} is not null`, ...usageConds(range, opts.serviceId)))
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

export interface UsageTotals {
	requests: number;
	costUsd: number;
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
	opts: { serviceId?: string } = {}
): Promise<UsageTotals> {
	const embedding = sql`${auditLog.model} ilike '%embedding%'`;
	const [row] = await db
		.select({
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			savedInputTokens: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			providerCachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)::bigint`,
			embeddingInputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}) filter (where ${embedding}), 0)::bigint`,
			embeddingOutputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}) filter (where ${embedding}), 0)::bigint`
		})
		.from(auditLog)
		.where(and(...usageConds(range, opts.serviceId)));

	return {
		requests: Number(row?.requests ?? 0),
		costUsd: Number(row?.cost ?? 0),
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
