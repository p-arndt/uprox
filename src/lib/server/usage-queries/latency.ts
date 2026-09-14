/**
 * Exact latency percentiles from a frequency histogram.
 *
 * `percentile_cont(...) within group (order by latency_ms)` sorts every row in
 * the window; on a few hundred thousand rows that sort spills to disk under the
 * default work_mem and dominated the usage page's load time. Latencies are whole
 * milliseconds with only a few thousand distinct values, so a `group by
 * latency_ms` hash aggregate is small and cheap, and the percentile can be
 * interpolated from it with exactly the arithmetic `percentile_cont` uses.
 *
 * Only the window totals use this. Measured per model (`group by model,
 * latency_ms`) the histogram was no faster than `percentile_cont`, so the
 * model-efficiency table keeps the plain aggregate.
 */
import { and, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import type { ResolvedRange } from '$lib/features/usage/range';
import type { UsageFilter } from '$lib/features/usage/group';
import { usageConds } from '$lib/server/usage-queries/predicates';

/** One histogram bucket: a latency value and how many requests measured it. */
export interface LatencyBucket {
	latencyMs: number;
	count: number;
}

/**
 * Continuous percentile over the histogram, matching Postgres' `percentile_cont`:
 * the value at 0-based position `p * (n - 1)` of the sorted sample, linearly
 * interpolated between its two neighbours. Null for an empty histogram. The
 * buckets may arrive in any order.
 */
export function percentileCont(buckets: readonly LatencyBucket[], p: number): number | null {
	const sorted = [...buckets].filter((b) => b.count > 0).sort((a, b) => a.latencyMs - b.latencyMs);
	const n = sorted.reduce((sum, b) => sum + b.count, 0);
	if (n === 0) return null;
	const pos = p * (n - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	const lower = valueAt(sorted, lo);
	return lo === hi ? lower : lower + (pos - lo) * (valueAt(sorted, hi) - lower);
}

/** The latency at 0-based rank `idx` of the sample the histogram expands to. */
function valueAt(sorted: readonly LatencyBucket[], idx: number): number {
	let seen = 0;
	for (const b of sorted) {
		seen += b.count;
		if (idx < seen) return b.latencyMs;
	}
	return sorted[sorted.length - 1].latencyMs;
}

/** The p50/p95 pair the usage UI shows, rounded to whole milliseconds. */
export function latencyPercentiles(buckets: readonly LatencyBucket[]): {
	latencyP50: number | null;
	latencyP95: number | null;
} {
	const round = (v: number | null) => (v == null ? null : Math.round(v));
	return {
		latencyP50: round(percentileCont(buckets, 0.5)),
		latencyP95: round(percentileCont(buckets, 0.95))
	};
}

type ScopeOpts = { serviceId?: string; tokenId?: string; filters?: UsageFilter[] };

/**
 * Latency histogram over the window. Rows without a latency (cache hits,
 * denials) are excluded, as `percentile_cont` ignores NULLs.
 */
export async function latencyHistogram(
	range: ResolvedRange,
	opts: ScopeOpts = {}
): Promise<LatencyBucket[]> {
	const rows = await db
		.select({ latencyMs: auditLog.latencyMs, count: sql<number>`count(*)::int` })
		.from(auditLog)
		.where(
			and(
				isNotNull(auditLog.latencyMs),
				...usageConds(range, opts.serviceId, opts.tokenId, opts.filters)
			)
		)
		.groupBy(auditLog.latencyMs);
	return rows.map((r) => ({ latencyMs: Number(r.latencyMs), count: Number(r.count) }));
}
