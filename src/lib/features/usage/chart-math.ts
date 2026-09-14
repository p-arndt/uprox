/**
 * Pure geometry and axis math for the stacked usage chart. Kept out of the
 * component so the numbers the chart draws can be tested without a DOM: the
 * component only maps these matrices onto elements.
 */
import type { SeriesBucket } from '$lib/features/usage/range';
import { formatCountCompact, formatTokens } from '$lib/format';
import { metricValue, type MetricPoint, type UsageMetric } from './metric';

/**
 * How the stack is scaled: absolute per-bucket values, each bucket as a share
 * of its own total (100% stacked), or the running total across the window.
 * One value rather than two booleans, because a running total rescaled to 100%
 * per bucket is a chart of nothing.
 */
export type ChartMode = 'absolute' | 'normalized' | 'cumulative';

/** Number of gridline intervals; 4 gives 5 labels including zero. */
export const CHART_TICKS = 4;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Buckets are UTC-aligned server-side, so they're formatted in UTC too —
 * formatting in the viewer's zone would smear the sub-day buckets.
 */
export function bucketLabel(iso: string, unit: SeriesBucket): string {
	const d = new Date(iso);
	const md = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
	if (unit === 'hour') return `${md} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
	if (unit === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
	if (unit === 'week') return `wk ${md}`;
	return md;
}

/**
 * Round a raw axis step up to the nearest "readable" number — 1, 2, 2.5 or 5
 * times a power of ten. Without this the axis reads $6.459 / $4.8443 /
 * $3.2295, which is the peak divided into quarters: technically accurate and
 * useless for estimating a bar's value at a glance.
 */
export function niceStep(raw: number): number {
	if (raw <= 0) return 1;
	const exp = Math.floor(Math.log10(raw));
	const pow = Math.pow(10, exp);
	const f = raw / pow;
	const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
	return nice * pow;
}

/**
 * values[seriesIndex][bucketIndex] for the selected metric, after the
 * cumulative transform. Everything downstream (stack geometry, axis, tooltip)
 * reads this one matrix, so the toggles can never leave the chart and its
 * labels disagreeing.
 */
export function valueMatrix(
	series: { points: MetricPoint[] }[],
	bucketCount: number,
	metric: UsageMetric,
	mode: ChartMode
): number[][] {
	return series.map((s) => {
		const row = Array.from({ length: bucketCount }, (_, i) => metricValue(s.points[i], metric));
		if (mode !== 'cumulative') return row;
		let acc = 0;
		return row.map((v) => (acc += v));
	});
}

/** Column sums of the value matrix: the height of each bucket's full stack. */
export function bucketTotals(values: number[][], bucketCount: number): number[] {
	return Array.from({ length: bucketCount }, (_, i) =>
		values.reduce((sum, row) => sum + (row[i] ?? 0), 0)
	);
}

export interface AxisScale {
	/** value between adjacent gridlines */
	step: number;
	/** value at the top of the plot area */
	peak: number;
	/** gridline values top-down, every one a whole multiple of the step */
	ticks: number[];
}

/**
 * Normalized mode rescales each bucket to its own total, so the axis is a
 * fixed 0-100%; otherwise the tallest stack is rounded up to a whole number of
 * nice steps, so every gridline lands on a round value and the bars keep a
 * little headroom instead of touching the ceiling.
 */
export function axisScale(totals: number[], mode: ChartMode): AxisScale {
	let step: number;
	if (mode === 'normalized') step = 100 / CHART_TICKS;
	else {
		const dataMax = Math.max(0, ...totals);
		step = niceStep((dataMax > 0 ? dataMax : 1) / CHART_TICKS);
	}
	const peak = step * CHART_TICKS;
	const ticks = Array.from({ length: CHART_TICKS + 1 }, (_, i) => (CHART_TICKS - i) * step);
	return { step, peak, ticks };
}

/**
 * Each segment's height as a percentage of the plot area, same shape as the
 * value matrix. Non-positive values get zero height.
 */
export function segmentHeights(
	values: number[][],
	totals: number[],
	peak: number,
	mode: ChartMode
): number[][] {
	return values.map((row) =>
		row.map((v, b) => {
			if (v <= 0) return 0;
			if (mode === 'normalized') {
				const total = totals[b];
				return total > 0 ? (v / total) * 100 : 0;
			}
			return (v / peak) * 100;
		})
	);
}

/** Topmost series with a visible segment in a bucket (it gets the rounded cap), or -1. */
export function topSegmentIndex(heights: number[][], bucketIdx: number): number {
	for (let i = heights.length - 1; i >= 0; i--) if ((heights[i][bucketIdx] ?? 0) > 0) return i;
	return -1;
}

/**
 * SVG path for one band of the stacked area variant, in a 0-100 viewBox:
 * the upper edge is the cumulative stack through `idx`, the lower edge the
 * stack through `idx - 1` (or the baseline).
 */
export function areaPath(heights: number[][], idx: number, bucketCount: number): string {
	if (bucketCount === 0) return '';
	const band = 100 / bucketCount;
	const xAt = (i: number) => ((i + 0.5) * band).toFixed(2);
	const edge = (through: number) =>
		Array.from({ length: bucketCount }, (_, b) => {
			let acc = 0;
			for (let s = 0; s <= through; s++) acc += heights[s]?.[b] ?? 0;
			return 100 - acc;
		});
	const upper = edge(idx);
	const lower = edge(idx - 1);
	const fwd = upper.map((y, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${y.toFixed(2)}`);
	const back = lower.map((y, i) => `L${xAt(i)},${y.toFixed(2)}`).reverse();
	return `${fwd.join(' ')} ${back.join(' ')} Z`;
}

/** Show roughly one x-axis label per ~8 buckets, so a 90-day window doesn't overprint. */
export function tickEvery(bucketCount: number): number {
	return Math.max(1, Math.ceil(bucketCount / 8));
}

/** Horizontal centre of a bucket as a percentage of the plot width. */
export function bucketCenterPct(bucketIdx: number, bucketCount: number): number {
	return ((bucketIdx + 0.5) / bucketCount) * 100;
}

/**
 * Cost tick text. Ticks are round numbers, so trailing zeroes are dropped and
 * compact notation starts at $1K to keep the axis narrow ($0, $2.5, $2.5K).
 */
export function axisUsd(v: number): string {
	if (v === 0) return '$0';
	if (Math.abs(v) >= 1000) {
		return `$${v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`;
	}
	const decimals = Math.abs(v) < 0.1 ? 3 : Math.abs(v) < 10 ? 2 : 0;
	return `$${Number(v.toFixed(decimals)).toLocaleString('en-US')}`;
}

/**
 * Axis-tick text: the shortest label that still identifies the level, which is
 * why the compact formatters are used rather than the exact headline ones.
 */
export function axisLabel(v: number, metric: UsageMetric, mode: ChartMode): string {
	if (mode === 'normalized') return `${Math.round(v)}%`;
	if (metric === 'cost') return axisUsd(v);
	if (metric === 'requests') return formatCountCompact(v);
	return formatTokens(v);
}

export interface HoverRow {
	key: string;
	label: string;
	color: string;
	value: number;
	/** the series' share of its bucket's total, 0-1 */
	share: number;
}

/**
 * Tooltip rows for one bucket: every series that actually contributed, largest
 * first, so a 12-series stack doesn't produce a wall of zeroes.
 */
export function hoverRows(
	series: { key: string; label: string }[],
	colors: string[],
	values: number[][],
	totals: number[],
	bucketIdx: number
): HoverRow[] {
	const total = totals[bucketIdx] ?? 0;
	return series
		.map((s, i) => {
			const value = values[i]?.[bucketIdx] ?? 0;
			return {
				key: s.key,
				label: s.label,
				color: colors[i],
				value,
				share: total > 0 ? value / total : 0
			};
		})
		.filter((r) => r.value > 0)
		.sort((a, b) => b.value - a.value);
}
