/** Period-over-period spend movers. */
import type { ResolvedRange } from '$lib/usage-range';
import type { UsageDimension, UsageFilter } from '$lib/usage-group';
import type { DimensionUsageRow, UsageMover } from '$lib/features/usage/types';
import { orgUsageByDimension } from '$lib/server/usage-queries/by-dimension';

/**
 * The series whose spend moved most between the selected window and the
 * immediately-preceding one of equal length — "what changed", which is the first
 * question anyone asks when a bill jumps.
 *
 * Ranked by ABSOLUTE dollar change, not percentage: a model going from $0.01 to
 * $0.05 is +400% and irrelevant, while one going from $400 to $480 is +20% and
 * the actual story. The percentage is still shown, just not what sorts.
 */
export async function orgTopMovers(
	range: ResolvedRange,
	prevRange: ResolvedRange,
	dim: UsageDimension,
	opts: {
		filters?: UsageFilter[];
		serviceId?: string;
		tokenId?: string;
		limit?: number;
		/** precomputed unlimited rankings for `range` / `prevRange`, when available */
		current?: DimensionUsageRow[];
		previous?: DimensionUsageRow[];
	} = {}
): Promise<UsageMover[]> {
	const byDim = { filters: opts.filters, serviceId: opts.serviceId, tokenId: opts.tokenId };
	const [current, previous] = await Promise.all([
		opts.current ?? orgUsageByDimension(range, dim, byDim),
		opts.previous ?? orgUsageByDimension(prevRange, dim, byDim)
	]);

	const prevByKey = new Map(previous.map((r) => [r.key, r]));
	const movers: UsageMover[] = current.map((r) => {
		const prior = prevByKey.get(r.key);
		const previousUsd = prior?.costUsd ?? 0;
		return {
			key: r.key,
			label: r.label,
			currentUsd: r.costUsd,
			previousUsd,
			deltaUsd: r.costUsd - previousUsd,
			deltaPct: previousUsd > 0 ? ((r.costUsd - previousUsd) / previousUsd) * 100 : null,
			isNew: previousUsd <= 0 && r.costUsd > 0,
			isGone: false
		};
	});

	// Series that existed before and have gone silent are movers too — arguably
	// the most interesting kind, since a disappearance is easy to miss otherwise.
	const currentKeys = new Set(current.map((r) => r.key));
	for (const r of previous) {
		if (currentKeys.has(r.key) || r.costUsd <= 0) continue;
		movers.push({
			key: r.key,
			label: r.label,
			currentUsd: 0,
			previousUsd: r.costUsd,
			deltaUsd: -r.costUsd,
			deltaPct: -100,
			isNew: false,
			isGone: true
		});
	}

	return movers
		.filter((m) => Math.abs(m.deltaUsd) > 0)
		.sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd))
		.slice(0, opts.limit ?? 8);
}
