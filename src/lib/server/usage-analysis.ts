import type { RequestEvent } from '@sveltejs/kit';
import {
	orgUsageByDimension,
	orgUsageSeriesGrouped,
	orgUsageFilterOptions,
	orgUsageTotals,
	orgUsageSeries,
	orgTokenMeters,
	orgTopMovers,
	orgModelEfficiency
} from '$lib/server/data';
import type { DimensionUsageRow, UsageAnalysis } from '$lib/features/usage/types';
import {
	USAGE_RANGES,
	resolveUsageRange,
	resolveSeriesBucket,
	normalizeBucket,
	shiftRangeBack,
	type ResolvedRange
} from '$lib/usage-range';
import {
	USAGE_DIMENSIONS,
	normalizeGroupBy,
	parseFilters,
	type UsageDimension,
	type UsageFilter
} from '$lib/usage-group';
import { MAX_SERIES } from '$lib/usage-colors';
import { readUsageWindow, writeUsageWindow } from '$lib/server/usage-window-pref';

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
): Promise<UsageAnalysis> {
	const params = event.url.searchParams;
	// Every window control navigates with an explicit ?range=, so a URL without
	// one is a fresh entry to the page (sidebar, bookmark, new tab) rather than a
	// deliberate choice — that is where the remembered window is restored. An
	// explicit param always wins, so shared links still open what they name.
	const stored = readUsageWindow(event.cookies);
	const fromUrl = params.has('range');
	const range = resolveUsageRange(fromUrl ? params.get('range') : (stored?.range ?? null), {
		from: fromUrl ? params.get('from') : stored?.from,
		to: fromUrl ? params.get('to') : stored?.to
	});
	// Resolve the effective bucket once so the current and previous-period series
	// share an identical granularity (and therefore align bucket-for-bucket).
	const bucket = fromUrl ? normalizeBucket(params.get('bucket')) : (stored?.bucket ?? 'auto');
	const unit = resolveSeriesBucket(range, bucket);
	const prevRange = shiftRangeBack(range);

	// the applied custom window, echoed back (inclusive end) so the picker pre-fills
	const customFrom = range.key === 'custom' ? ymd(range.start) : null;
	const customTo =
		range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null;
	writeUsageWindow(
		event.cookies,
		{ range: range.key, from: customFrom, to: customTo, bucket },
		stored
	);

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

	// The breakdown table, the donuts, the filter pickers, the stacked chart's
	// ranking pass and the movers all read the same by-dimension aggregate. Each
	// distinct (window, dimension, filters) is queried once, unlimited, and every
	// consumer slices its own top-N from it; the scope is fixed for this call.
	const rankings = new Map<string, Promise<DimensionUsageRow[]>>();
	const ranked = (r: ResolvedRange, dim: UsageDimension, f: UsageFilter[]) => {
		const key = JSON.stringify([r.start, r.end ?? null, dim, f]);
		let rows = rankings.get(key);
		if (!rows) {
			rows = orgUsageByDimension(r, dim, { ...scope, filters: f });
			rankings.set(key, rows);
		}
		return rows;
	};

	const [
		totals,
		prevTotals,
		grouped,
		breakdown,
		donuts,
		filterOptions,
		meters,
		movers,
		efficiency,
		series,
		prevSeries
	] = await Promise.all([
		orgUsageTotals(range, { ...scope, filters }),
		// previous equal-length window — powers the headline deltas. Filters carry
		// over, or the comparison would be against a differently-scoped population.
		orgUsageTotals(prevRange, { ...scope, filters }),
		ranked(range, groupBy, filters).then((rows) =>
			orgUsageSeriesGrouped(range, groupBy, {
				...scope,
				unit: bucket,
				filters,
				limit: MAX_SERIES,
				ranked: rows
			})
		),
		ranked(range, groupBy, filters).then((rows) => rows.slice(0, BREAKDOWN_LIMIT)),
		Promise.all(
			donutDims.map(async (dim) => ({
				dim,
				rows: (await ranked(range, dim, filters)).slice(0, 25)
			}))
		),
		// pickers are deliberately derived from the unfiltered window
		orgUsageFilterOptions(range, dimensions, {
			...scope,
			loadRanked: (dim) => ranked(range, dim, [])
		}),
		orgTokenMeters(range, { ...scope, filters }),
		// "what changed" is always measured on the grouping the operator picked,
		// so the answer lines up with the chart directly above it
		Promise.all([ranked(range, groupBy, filters), ranked(prevRange, groupBy, filters)]).then(
			([current, previous]) =>
				orgTopMovers(range, prevRange, groupBy, { ...scope, filters, current, previous })
		),
		orgModelEfficiency(range, { ...scope, filters }),
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
		customFrom,
		customTo,
		totals,
		prevTotals,
		grouped,
		breakdown,
		donuts,
		meters,
		movers,
		efficiency,
		series,
		// only the points are needed for the overlay; the unit matches `series`
		prevPoints: prevSeries.points
	};
}

export type { UsageAnalysis };
