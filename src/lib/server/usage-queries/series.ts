/** Flat usage time series behind the headline sparklines and trend charts. */
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import { resolveSeriesBucket, type BucketChoice, type ResolvedRange } from '$lib/usage-range';
import type { UsageFilter } from '$lib/usage-group';
import { BUCKET_STEP } from '$lib/server/usage-queries/buckets';
import { usageCondsSql } from '$lib/server/usage-queries/predicates';
import type { UsageSeries } from '$lib/features/usage/types';

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
			-- the shared predicate bounds created_at to the window, so the join
			-- only reads the selected range instead of the whole table
			and ${usageCondsSql(range, opts.filters)}
			${serviceFilter}
			${tokenFilter}
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
