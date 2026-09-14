/** Row and series shapes shared by the cost-analysis queries. */
import type { SeriesBucket } from '$lib/usage-range';

/** One row of a by-dimension breakdown: a single series' totals over the window. */
export interface DimensionUsageRow {
	/** the raw grouping value — a uuid, a model name, or NULL_VALUE/OTHERS_KEY */
	key: string;
	/** display name; falls back to the key when the joined row is gone */
	label: string;
	/** secondary detail (a model's provider, a token's masked display) */
	hint: string | null;
	costUsd: number;
	requests: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
	/**
	 * Effective unit price in USD per million tokens, for the dimensions where one
	 * row really is one rate (`line`). Absent elsewhere: a row that mixes input and
	 * output, or several models, has an average rather than a price, and printing
	 * an average in a column headed "$/Mtok" invites it to be checked against a
	 * rate card it was never taken from.
	 */
	ratePerMtok?: number | null;
}

/** One coloured band of the stacked chart: a series and its value per bucket. */
export interface GroupedSeries {
	key: string;
	label: string;
	hint: string | null;
	/** aligned 1:1 with {@link GroupedSeriesResult.buckets} */
	points: { requests: number; denied: number; costUsd: number; tokens: number }[];
	/** window totals, for the legend and tooltip */
	costUsd: number;
	requests: number;
	tokens: number;
}

export interface GroupedSeriesResult {
	unit: SeriesBucket;
	/** UTC-aligned bucket starts, ISO-8601 with a trailing Z */
	buckets: string[];
	series: GroupedSeries[];
	/** true when traffic outside the top-N was folded into the "Others" series */
	hasOthers: boolean;
}
