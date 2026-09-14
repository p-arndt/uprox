/** Exact headline usage totals. */
import { and, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import type { ResolvedRange } from '$lib/usage-range';
import type { UsageFilter } from '$lib/usage-group';
import { usageConds } from '$lib/server/usage-queries/predicates';
import { latencyHistogram } from '$lib/server/usage-queries/latency';
import { mapTotalsRow } from '$lib/server/usage-queries/row-mapping';
import type { UsageTotals } from '$lib/features/usage/types';

export type { UsageTotals };

/**
 * Headline aggregates for the whole org (or one service, with `serviceId`) over
 * the window — the single source for the token/cost cards. Computed in one query
 * rather than summing a breakdown so the figures are exact even past the top-N
 * row limits. The embedding subset is broken out so the page can offer a toggle
 * to exclude high-volume, low-cost embedding tokens from the headline.
 *
 * Latency percentiles come from a parallel histogram query (see ./latency.ts):
 * exact, but without sorting every row of the window.
 */
export async function orgUsageTotals(
	range: ResolvedRange,
	opts: {
		serviceId?: string;
		tokenId?: string;
		filters?: UsageFilter[];
		/**
		 * Set false to skip the latency percentiles (returned as null) when the
		 * caller doesn't show them, e.g. the previous-period comparison, which
		 * only feeds the spend, request and token deltas.
		 */
		latency?: boolean;
	} = {}
): Promise<UsageTotals> {
	const embedding = sql`${auditLog.model} ilike '%embedding%'`;
	const [[row], histogram] = await Promise.all([
		db
			.select({
				requests: sql<number>`count(*)::int`,
				cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
				errors: sql<number>`(count(*) filter (where ${auditLog.status} = 'error'))::int`,
				denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
				inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
				outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
				savedInputTokens: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
				providerCachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)::bigint`,
				embeddingInputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}) filter (where ${embedding}), 0)::bigint`,
				embeddingOutputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}) filter (where ${embedding}), 0)::bigint`
			})
			.from(auditLog)
			.where(and(...usageConds(range, opts.serviceId, opts.tokenId, opts.filters))),
		// percentiles over the rows that actually recorded a latency (cache hits
		// and denials don't), so the figure reflects real upstream round-trips
		opts.latency === false ? Promise.resolve([]) : latencyHistogram(range, opts)
	]);

	return mapTotalsRow(row, histogram);
}
