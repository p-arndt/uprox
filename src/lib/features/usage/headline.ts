/**
 * The headline band's cells, built from window totals. Pure so the deltas and
 * notes are testable without the card.
 */
import { cacheRate, type CacheRateInput } from '$lib/cache-rate';
import { formatCount, formatTokens, formatUsd } from '$lib/format';

export interface HeadlineTotals extends CacheRateInput {
	requests: number;
	costUsd: number;
	errors: number;
	denied: number;
	latencyP50: number | null;
	latencyP95: number | null;
	outputTokens: number;
}

export interface HeadlinePoint {
	requests: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
}

export interface HeadlineCell {
	label: string;
	value: string;
	/** signed % vs the previous window, null without a baseline, absent where meaningless */
	delta?: number | null;
	tone?: 'cost' | 'neutral';
	/** the qualifier under the figure — where the number came from */
	note: string;
	/** per-bucket values; cells without a meaningful trend line omit it */
	spark?: number[];
}

/**
 * Period-over-period change in percent against the immediately-preceding
 * equal-length window. Null when there's no prior baseline to divide by.
 */
export function pctDelta(cur: number, prior: number): number | null {
	if (!prior || prior <= 0) return null;
	return ((cur - prior) / prior) * 100;
}

/** Latency in ms, switching to seconds from 1s up; em dash when unmeasured. */
export function formatLatencyMs(ms: number | null): string {
	if (ms == null) return '—';
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function headlineCells(
	totals: HeadlineTotals,
	prevTotals: HeadlineTotals,
	points: HeadlinePoint[]
): HeadlineCell[] {
	const totalTokens = totals.inputTokens + totals.outputTokens;
	const avgCostPerReq = totals.requests > 0 ? totals.costUsd / totals.requests : 0;
	const errorRate = totals.requests > 0 ? totals.errors / totals.requests : 0;
	return [
		{
			label: 'Spend',
			value: formatUsd(totals.costUsd),
			delta: pctDelta(totals.costUsd, prevTotals.costUsd),
			tone: 'cost',
			note: `${formatUsd(avgCostPerReq)} avg / request`,
			spark: points.map((p) => p.costUsd)
		},
		{
			label: 'Requests',
			value: formatCount(totals.requests),
			delta: pctDelta(totals.requests, prevTotals.requests),
			note: `${(errorRate * 100).toFixed(1)}% errors · ${formatCount(totals.denied)} denied`,
			spark: points.map((p) => p.requests)
		},
		{
			label: 'Tokens',
			value: formatTokens(totalTokens),
			delta: pctDelta(totalTokens, prevTotals.inputTokens + prevTotals.outputTokens),
			note: `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`,
			spark: points.map((p) => p.inputTokens + p.outputTokens)
		},
		{
			label: 'Cache rate',
			value: `${(cacheRate(totals).rate * 100).toFixed(1)}%`,
			note: `${formatTokens(totals.savedInputTokens)} uprox · ${formatTokens(totals.providerCachedTokens)} provider`
		},
		{
			label: 'Latency p95',
			value: formatLatencyMs(totals.latencyP95),
			note: `p50 ${formatLatencyMs(totals.latencyP50)}`
		}
	];
}
