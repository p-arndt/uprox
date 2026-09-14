/** Exact headline usage totals. */
import { and, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import type { ResolvedRange } from '$lib/usage-range';
import type { UsageFilter } from '$lib/usage-group';
import { usageConds } from '$lib/server/usage-queries/predicates';
import type { UsageTotals } from '$lib/features/usage/types';

export type { UsageTotals };

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
