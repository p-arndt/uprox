/**
 * Row and series shapes shared by the cost-analysis queries. They are defined in
 * `$lib/features/usage/types` so client code can use them; re-exported here so
 * existing server imports keep compiling.
 */
export type {
	DimensionUsageRow,
	GroupedSeries,
	GroupedSeriesResult
} from '$lib/features/usage/types';
