import type { RequestEvent } from '@sveltejs/kit';
import {
	orgUsageByDimension,
	orgUsageSeriesGrouped,
	orgUsageFilterOptions,
	orgUsageTotals,
	orgUsageSeries,
	orgTokenMeters
} from '$lib/server/data';
import {
	USAGE_RANGES,
	resolveUsageRange,
	resolveSeriesBucket,
	normalizeBucket,
	shiftRangeBack
} from '$lib/usage-range';
import {
	USAGE_DIMENSIONS,
	normalizeGroupBy,
	parseFilters,
	type UsageDimension
} from '$lib/usage-group';
import { MAX_SERIES } from '$lib/usage-colors';

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Top-N for the detail table; surfaced so the page can flag truncation. */
const BREAKDOWN_LIMIT = 100;

/**
 * Builds the entire cost-analysis payload for a page, given the request and an
 * optional scope. Shared by /app/usage (org-wide), the service-detail page
 * (scoped to one service) and the token-detail page (scoped to one token), so
 * all three genuinely render the same workbench instead of the org page getting
 * the good one and the detail pages keeping a cut-down copy.
 *
 * `dimensions` is what the caller allows grouping and filtering by. A
 * service-detail page drops the `service` dimension because it would collapse
 * to a single row, and a token page drops both `service` and `token` for the
 * same reason — a dimension with one value is a label, not an analysis.
 */
export async function loadUsageAnalysis(
	event: RequestEvent,
	opts: {
		dimensions?: readonly UsageDimension[];
		serviceId?: string;
		tokenId?: string;
		/** donut panels; defaults to the first three allowed dimensions */
		donutDims?: readonly UsageDimension[];
	} = {}
) {
	const params = event.url.searchParams;
	const range = resolveUsageRange(params.get('range'), {
		from: params.get('from'),
		to: params.get('to')
	});
	// Resolve the effective bucket once so the current and previous-period series
	// share an identical granularity (and therefore align bucket-for-bucket).
	const bucket = normalizeBucket(params.get('bucket'));
	const unit = resolveSeriesBucket(range, bucket);
	const prevRange = shiftRangeBack(range);

	const dimensions = opts.dimensions ?? USAGE_DIMENSIONS.map((d) => d.key);
	const donutDims = opts.donutDims ?? dimensions.slice(0, 3);
	const scope = { serviceId: opts.serviceId, tokenId: opts.tokenId };

	// A group-by the caller doesn't allow (a stale URL, a hand-edited param)
	// falls back to the first dimension that IS allowed, rather than 500ing on a
	// dimension the page can't render.
	const requested = normalizeGroupBy(params.get('group'));
	const groupBy = dimensions.includes(requested) ? requested : dimensions[0];
	// Filters on disallowed dimensions are dropped for the same reason.
	const filters = parseFilters(params.getAll('f')).filter((f) => dimensions.includes(f.dim));

	const [
		totals,
		prevTotals,
		grouped,
		breakdown,
		donuts,
		filterOptions,
		meters,
		series,
		prevSeries
	] = await Promise.all([
		orgUsageTotals(range, { ...scope, filters }),
		// previous equal-length window — powers the headline deltas. Filters carry
		// over, or the comparison would be against a differently-scoped population.
		orgUsageTotals(prevRange, { ...scope, filters }),
		orgUsageSeriesGrouped(range, groupBy, { ...scope, unit: bucket, filters, limit: MAX_SERIES }),
		orgUsageByDimension(range, groupBy, { ...scope, filters, limit: BREAKDOWN_LIMIT }),
		Promise.all(
			donutDims.map(async (dim) => ({
				dim,
				rows: await orgUsageByDimension(range, dim, { ...scope, filters, limit: 25 })
			}))
		),
		orgUsageFilterOptions(range, dimensions, scope),
		orgTokenMeters(range, { ...scope, filters }),
		// flat series behind the headline sparklines — same window, same filters
		orgUsageSeries(range, { ...scope, unit, filters }),
		orgUsageSeries(prevRange, { ...scope, unit, filters })
	]);

	return {
		range: range.key,
		ranges: USAGE_RANGES,
		bucket,
		groupBy,
		filters,
		filterOptions,
		dimensions,
		breakdownLimit: BREAKDOWN_LIMIT,
		breakdownTruncated: breakdown.length >= BREAKDOWN_LIMIT,
		// the applied custom window echoed back (inclusive end) so the picker pre-fills
		customFrom: range.key === 'custom' ? ymd(range.start) : null,
		customTo:
			range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null,
		totals,
		prevTotals,
		grouped,
		breakdown,
		donuts,
		meters,
		series,
		// only the points are needed for the overlay; the unit matches `series`
		prevPoints: prevSeries.points
	};
}

export type UsageAnalysis = Awaited<ReturnType<typeof loadUsageAnalysis>>;
