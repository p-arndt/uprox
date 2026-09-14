/**
 * Client-facing result shapes of the cost-analysis queries. They live outside
 * `$lib/server` so components and pages can type their props without reaching
 * into server modules; the query modules import (and re-export) them from here.
 */
import type {
	BucketChoice,
	ResolvedRangeKey,
	SeriesBucket,
	UsageRangeOption
} from '$lib/usage-range';
import type { UsageDimension, UsageFilter, UsageFilterOptions } from '$lib/usage-group';
import type { TokenMeterBreakdown } from '$lib/server/usage-queries/meters';

export type { UsageFilterOption, UsageFilterOptions } from '$lib/usage-group';

export interface UsageTotals {
	requests: number;
	costUsd: number;
	/** requests the upstream/gateway answered with an error status */
	errors: number;
	/** requests blocked by policy/budget before reaching upstream */
	denied: number;
	/** median upstream latency in ms over the window, or null when unmeasured */
	latencyP50: number | null;
	/** 95th-percentile upstream latency in ms, or null when unmeasured */
	latencyP95: number | null;
	inputTokens: number;
	outputTokens: number;
	savedInputTokens: number;
	providerCachedTokens: number;
	/** subset of input/output tokens attributable to embedding models */
	embeddingInputTokens: number;
	embeddingOutputTokens: number;
}

export interface UsageSeriesPoint {
	/** UTC-aligned bucket start, ISO-8601 with a trailing Z (e.g. 2026-06-03T00:00:00Z) */
	bucket: string;
	requests: number;
	denied: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
}

export interface UsageSeries {
	/** bucket granularity used for the window (see resolveSeriesBucket) */
	unit: SeriesBucket;
	points: UsageSeriesPoint[];
}

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

export interface UsageMover {
	key: string;
	label: string;
	currentUsd: number;
	previousUsd: number;
	deltaUsd: number;
	/** null when there's no prior baseline to divide by (a new series) */
	deltaPct: number | null;
	isNew: boolean;
	isGone: boolean;
}

export interface ModelEfficiency {
	model: string;
	provider: string | null;
	requests: number;
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	/** USD per 1,000 tokens (input + output) — the comparable unit price */
	costPer1kTokens: number;
	costPerRequest: number;
	/** output ÷ input; high means verbose answers, which is where cost lands */
	outputRatio: number | null;
	/** share of input served from the provider's prompt cache */
	cacheReadShare: number;
	latencyP50: number | null;
	latencyP95: number | null;
}

/** One composition ring: a dimension and its top rows. */
export interface UsageDonutPanel {
	dim: UsageDimension;
	rows: DimensionUsageRow[];
}

/** The cost-analysis payload shared by the usage, service and token pages. */
export interface UsageAnalysis {
	range: ResolvedRangeKey;
	ranges: readonly UsageRangeOption[];
	bucket: BucketChoice;
	groupBy: UsageDimension;
	filters: UsageFilter[];
	filterOptions: UsageFilterOptions;
	dimensions: readonly UsageDimension[];
	breakdownLimit: number;
	breakdownTruncated: boolean;
	customFrom: string | null;
	customTo: string | null;
	totals: UsageTotals;
	prevTotals: UsageTotals;
	grouped: GroupedSeriesResult;
	breakdown: DimensionUsageRow[];
	donuts: UsageDonutPanel[];
	meters: TokenMeterBreakdown;
	movers: UsageMover[];
	efficiency: ModelEfficiency[];
	series: UsageSeries;
	/** only the points are needed for the overlay; the unit matches `series` */
	prevPoints: UsageSeriesPoint[];
}
