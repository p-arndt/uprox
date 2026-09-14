/** Per-model unit economics. */
import { and, desc, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import type { ResolvedRange } from '$lib/usage-range';
import type { UsageFilter } from '$lib/usage-group';
import { usageConds } from '$lib/server/usage-queries/predicates';
import type { ModelEfficiency } from '$lib/features/usage/types';

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
