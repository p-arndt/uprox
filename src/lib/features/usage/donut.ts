/**
 * Slice folding and ring geometry for the usage donut. Pure so the numbers the
 * ring draws (and the "Others" reconciliation against the scope total) are
 * testable without rendering.
 */
import { colorForSeries, OTHERS_COLOR } from '$lib/usage-colors';
import type { UsageMetric } from './metric';

/** The fields of a dimension usage row the donut reads. */
export interface DonutRow {
	key: string;
	label: string;
	costUsd: number;
	requests: number;
	inputTokens: number;
	outputTokens: number;
}

export interface DonutSlice {
	key: string;
	label: string;
	value: number;
	color: string;
}

export interface DonutArc extends DonutSlice {
	/** share of the total, 0-100 */
	pct: number;
	/** visible dash length on a circumference of 100 */
	dash: number;
	/** where the arc starts along the circumference */
	offset: number;
}

/** Key of the folded tail slice. */
export const DONUT_TAIL_KEY = '__tail__';

/** Radius whose circumference is exactly 100, so a percentage IS the dash length. */
export const DONUT_RADIUS = 15.9155;
export const DONUT_CIRCUMFERENCE = 100;

/** Dash trimmed from each arc so neighbours keep a ~2px surface gap. */
const ARC_GAP = 0.6;

export function donutRowValue(r: DonutRow, metric: UsageMetric): number {
	if (metric === 'cost') return r.costUsd;
	if (metric === 'requests') return r.requests;
	return r.inputTokens + r.outputTokens;
}

/**
 * Rank rows by the displayed metric (not the server's cost ordering, or the
 * ring and the list would disagree about which slice is biggest), keep the top
 * `limit` non-empty ones, and fold everything else into one neutral slice.
 *
 * The total prefers the authoritative `scopeTotal`: `rows` is a server-side
 * top-N, so summing it would under-count and the ring would disagree with the
 * headline. The difference lands in "Others", so the ring always closes.
 */
export function donutSlices(
	rows: DonutRow[],
	dim: string,
	metric: UsageMetric,
	limit: number,
	scopeTotal: number | null
): { total: number; slices: DonutSlice[] } {
	const valueOf = (r: DonutRow) => donutRowValue(r, metric);
	const ranked = [...rows].sort((a, b) => valueOf(b) - valueOf(a));
	const rowsTotal = ranked.reduce((s, r) => s + valueOf(r), 0);
	const total = scopeTotal != null && scopeTotal > 0 ? scopeTotal : rowsTotal;

	const head = ranked.slice(0, limit).filter((r) => valueOf(r) > 0);
	const headValue = head.reduce((s, r) => s + valueOf(r), 0);
	const tailValue = Math.max(0, total - headValue);
	// Past the cut, one neutral slice rather than a recycled hue — a repeated
	// colour would claim two entities are the same.
	const slices: DonutSlice[] = head.map((r, i) => ({
		key: r.key,
		label: r.label,
		value: valueOf(r),
		color: colorForSeries(dim, r.key, i)
	}));
	if (tailValue > 0) {
		slices.push({
			key: DONUT_TAIL_KEY,
			label: ranked.length > head.length ? `Others (${ranked.length - head.length}+)` : 'Others',
			value: tailValue,
			color: OTHERS_COLOR
		});
	}
	return { total, slices };
}

/** Lay slices end to end around a circumference of 100. */
export function donutArcs(slices: DonutSlice[], total: number): DonutArc[] {
	let offset = 0;
	return slices.map((s) => {
		const pct = total > 0 ? (s.value / total) * 100 : 0;
		const arc = { ...s, pct, dash: Math.max(0, pct - ARC_GAP), offset };
		offset += pct;
		return arc;
	});
}
