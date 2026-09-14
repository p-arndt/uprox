/**
 * Pure row-to-result mapping for the usage queries. The driver hands aggregates
 * back as numbers, numeric strings (`numeric`, `bigint`) or NULL; these helpers
 * normalise them in one place, which keeps the query functions about SQL.
 */
import { cacheRate } from '$lib/features/usage/cache-rate';
import type { GroupedSeries, UsageTotals } from '$lib/features/usage/types';
import { latencyPercentiles, type LatencyBucket } from '$lib/server/usage-queries/latency';

/** An aggregate as the driver returns it. */
export type Aggregate = number | string | null | undefined;

/** An aggregate as a number, with NULL (no rows) as zero. */
export const num = (v: Aggregate): number => Number(v ?? 0);

export interface TotalsRow {
	requests: Aggregate;
	cost: Aggregate;
	errors: Aggregate;
	denied: Aggregate;
	inputTokens: Aggregate;
	outputTokens: Aggregate;
	savedInputTokens: Aggregate;
	providerCachedTokens: Aggregate;
	embeddingInputTokens: Aggregate;
	embeddingOutputTokens: Aggregate;
}

/** The headline totals from the aggregate row and the window's latency histogram. */
export function mapTotalsRow(
	row: Partial<TotalsRow> | undefined,
	histogram: readonly LatencyBucket[]
): UsageTotals {
	const r = row ?? {};
	return {
		requests: num(r.requests),
		costUsd: num(r.cost),
		errors: num(r.errors),
		denied: num(r.denied),
		...latencyPercentiles(histogram),
		inputTokens: num(r.inputTokens),
		outputTokens: num(r.outputTokens),
		savedInputTokens: num(r.savedInputTokens),
		providerCachedTokens: num(r.providerCachedTokens),
		embeddingInputTokens: num(r.embeddingInputTokens),
		embeddingOutputTokens: num(r.embeddingOutputTokens)
	};
}

export interface OrgTrafficRow {
	total: Aggregate;
	cost: Aggregate;
	denied: Aggregate;
	cacheHits: Aggregate;
	cacheSaved: Aggregate;
	providerCachedTokens: Aggregate;
	inputTokens: Aggregate;
	outputTokens: Aggregate;
	savedInputTokens: Aggregate;
	savedOutputTokens: Aggregate;
	embeddingInputTokens: Aggregate;
}

/** The overview page's stats from the entity counts and the all-time traffic row. */
export function mapOrgStats(
	counts: { services: Aggregate; providers: Aggregate; activeTokens: Aggregate },
	traffic: Partial<OrgTrafficRow> | undefined
) {
	const t = traffic ?? {};
	const total = num(t.total);
	const cacheHits = num(t.cacheHits);
	const inputTokens = num(t.inputTokens);
	const savedInputTokens = num(t.savedInputTokens);
	const providerCachedTokens = num(t.providerCachedTokens);

	// share of input tokens that benefited from any cache layer — see cacheRate()
	const { rate: tokenCacheRate } = cacheRate({
		inputTokens,
		embeddingInputTokens: num(t.embeddingInputTokens),
		savedInputTokens,
		providerCachedTokens
	});

	return {
		services: num(counts.services),
		providers: num(counts.providers),
		activeTokens: num(counts.activeTokens),
		requests: total,
		denied: num(t.denied),
		costUsd: num(t.cost),
		cacheHits,
		// share of all gateway requests served from uprox's cache (0–1) — kept
		// for callers that want the request-count view, but the headline tile
		// now uses tokenCacheRate so provider cache counts too.
		cacheHitRate: total > 0 ? cacheHits / total : 0,
		// share of input tokens that benefited from any cache layer (0–1)
		tokenCacheRate,
		// exact: sum of each hit's recorded saved amount
		cacheSavedUsd: num(t.cacheSaved),
		// total input tokens upstream providers served from their own prompt cache
		providerCachedTokens,
		inputTokens,
		outputTokens: num(t.outputTokens),
		savedInputTokens,
		savedOutputTokens: num(t.savedOutputTokens)
	};
}

/** One (bucket, series) cell of the stacked-chart query. */
export interface GroupedRow {
	bucket: string;
	key: string;
	requests: Aggregate;
	denied: Aggregate;
	cost: Aggregate;
	tokens: Aggregate;
}

/**
 * Positional rebuild of the stacked-chart cells: buckets in first-seen
 * (ascending) order, then one dense point array per axis series indexed by that
 * bucket order. Cells for keys outside the axis are ignored.
 */
export function foldGroupedRows(
	rows: readonly GroupedRow[],
	axis: readonly { key: string; label: string; hint: string | null }[]
): { buckets: string[]; series: GroupedSeries[] } {
	const buckets: string[] = [];
	const bucketIndex = new Map<string, number>();
	for (const r of rows) {
		if (!bucketIndex.has(r.bucket)) {
			bucketIndex.set(r.bucket, buckets.length);
			buckets.push(r.bucket);
		}
	}

	const series: GroupedSeries[] = axis.map((a) => ({
		key: a.key,
		label: a.label,
		hint: a.hint,
		points: buckets.map(() => ({ requests: 0, denied: 0, costUsd: 0, tokens: 0 })),
		costUsd: 0,
		requests: 0,
		tokens: 0
	}));
	const seriesIndex = new Map(series.map((s, i) => [s.key, i]));

	for (const r of rows) {
		const si = seriesIndex.get(r.key);
		const bi = bucketIndex.get(r.bucket);
		if (si === undefined || bi === undefined) continue;
		const s = series[si];
		const point = {
			requests: num(r.requests),
			denied: num(r.denied),
			costUsd: num(r.cost),
			tokens: num(r.tokens)
		};
		s.points[bi] = point;
		s.costUsd += point.costUsd;
		s.requests += point.requests;
		s.tokens += point.tokens;
	}

	return { buckets, series };
}
