/** Headline stats and the daily sparkline for the overview page. */
import { isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, machineToken, providerSecret, auditLog } from '$lib/server/db/schema';
import { cacheRate } from '$lib/cache-rate';

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
