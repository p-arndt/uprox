import { formatCount, formatTokens, formatUsd } from '$lib/format';

/**
 * The figure a usage view is plotting. One definition shared by the chart, its
 * legend, the donuts and the card that switches between them, so adding a
 * metric can't leave one of them silently comparing against a stale union.
 */
export type UsageMetric = 'cost' | 'requests' | 'tokens';

/** The per-bucket fields every metric reads from. */
export interface MetricPoint {
	costUsd: number;
	requests: number;
	tokens: number;
}

/** Pick the selected metric off a point (or a series total with the same shape). */
export function metricValue(p: MetricPoint | undefined, metric: UsageMetric): number {
	if (!p) return 0;
	if (metric === 'cost') return p.costUsd;
	if (metric === 'requests') return p.requests;
	return p.tokens;
}

/** Exact value text for a metric: headline figures, tooltips, legends, accessible labels. */
export function formatMetric(v: number, metric: UsageMetric): string {
	if (metric === 'cost') return formatUsd(v);
	if (metric === 'requests') return formatCount(v);
	return formatTokens(v);
}
