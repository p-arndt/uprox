import type { RequestEvent } from '@sveltejs/kit';
import {
	orgUsageByDimension,
	orgUsageSeriesGrouped,
	orgUsageFilterOptions
} from '$lib/server/usage-queries/by-dimension';
import { orgUsageTotals } from '$lib/server/usage-queries/totals';
import { orgUsageSeries } from '$lib/server/usage-queries/series';
import { orgTokenMeters } from '$lib/server/usage-queries/meters';
import { orgTopMovers } from '$lib/server/usage-queries/movers';
import { orgModelEfficiency } from '$lib/server/usage-queries/efficiency';
import type { DimensionUsageRow, Streamed, UsageAnalysis } from '$lib/features/usage/types';
import {
	USAGE_RANGES,
	resolveUsageRange,
	resolveSeriesBucket,
	normalizeBucket,
	shiftRangeBack,
	type ResolvedRange
} from '$lib/features/usage/range';
import {
	USAGE_DIMENSIONS,
	normalizeGroupBy,
	parseFilters,
	type UsageDimension,
	type UsageFilter,
	type UsageFilterOptions
} from '$lib/features/usage/group';
import { MAX_SERIES } from '$lib/features/usage/colors';
import { readUsageWindow, writeUsageWindow } from '$lib/server/usage-window-pref';
import { cacheWindow, usageCache, usageCacheKey } from '$lib/server/usage-cache';

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Top-N for the detail table; surfaced so the page can flag truncation. */
const BREAKDOWN_LIMIT = 100;

/**
 * Wraps a promise that is returned un-awaited from a load function, so SvelteKit
 * streams it. It never rejects: a failure is logged and resolves to `empty` with
 * `failed` set, which the panel renders as an inline error.
 */
export function streamed<T>(promise: Promise<T>, empty: T, label: string): Promise<Streamed<T>> {
	return promise.then(
		(value) => ({ value, failed: false }),
		(err: unknown) => {
			console.error(`usage: streamed panel "${label}" failed`, err);
			return { value: empty, failed: true };
		}
	);
}

/**
 * The analysis window and view choices a request asks for, resolved against the
 * remembered window cookie (which it also updates) and the allowed dimensions.
 */
function resolveUsageRequest(event: RequestEvent, dimensions: readonly UsageDimension[]) {
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

	// the applied custom window, echoed back (inclusive end) so the picker pre-fills
	const customFrom = range.key === 'custom' ? ymd(range.start) : null;
	const customTo =
		range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null;
	writeUsageWindow(
		event.cookies,
		{ range: range.key, from: customFrom, to: customTo, bucket },
		stored
	);

	// A group-by the caller doesn't allow (a stale URL, a hand-edited param)
	// falls back to the first dimension that IS allowed, rather than 500ing on a
	// dimension the page can't render.
	const requested = normalizeGroupBy(params.get('group'));
	const groupBy = dimensions.includes(requested) ? requested : dimensions[0];
	// Filters on disallowed dimensions are dropped for the same reason.
	const filters = parseFilters(params.getAll('f')).filter((f) => dimensions.includes(f.dim));

	return {
		range,
		prevRange: shiftRangeBack(range),
		bucket,
		unit: resolveSeriesBucket(range, bucket),
		customFrom,
		customTo,
		groupBy,
		filters,
		// the refresh button's cache bypass
		fresh: params.get('fresh') === '1'
	};
}

/**
 * Runs queries through the in-process cache. Both windows are identified once,
 * up front, so every query in the request agrees on rolling vs closed.
 */
function cachedQueries(opts: {
	range: ResolvedRange;
	prevRange: ResolvedRange;
	scope: { serviceId?: string; tokenId?: string };
	fresh: boolean;
}) {
	const now = Date.now();
	const windows = new Map([
		[opts.range, cacheWindow(opts.range, { now })],
		[opts.prevRange, cacheWindow(opts.prevRange, { now, previousOf: opts.range })]
	]);
	return <T>(
		query: string,
		r: ResolvedRange,
		parts: { dim?: string; filters?: UsageFilter[]; bucket?: string },
		load: () => Promise<T>
	): Promise<T> => {
		const window = windows.get(r)!;
		const key = usageCacheKey({ query, window, ...opts.scope, ...parts });
		return usageCache.fetch(key, window.ttlMs, load, opts.fresh);
	};
}

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
 *
 * Only what the first paint needs is awaited (headline totals, the sparkline
 * series, the stacked chart and the breakdown table). Everything else is
 * returned as a promise and streamed in, so the page is usable while the
 * secondary panels are still computing.
 *
 * Query results are cached in process (see usage-cache.ts); `?fresh=1` skips
 * cached values, which is what the refresh button sends.
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
	const dimensions = opts.dimensions ?? USAGE_DIMENSIONS.map((d) => d.key);
	const donutDims = opts.donutDims ?? dimensions.slice(0, 3);
	const scope = { serviceId: opts.serviceId, tokenId: opts.tokenId };
	const request = resolveUsageRequest(event, dimensions);
	const { range, prevRange, bucket, unit, groupBy, filters } = request;
	const cached = cachedQueries({ range, prevRange, scope, fresh: request.fresh });

	// The breakdown table, the donuts, the filter pickers, the stacked chart's
	// ranking pass and the movers all read the same by-dimension aggregate. Each
	// distinct (window, dimension, filters) is queried once, unlimited, and every
	// consumer slices its own top-N from it; the scope is fixed for this call.
	const rankings = new Map<string, Promise<DimensionUsageRow[]>>();
	const ranked = (r: ResolvedRange, dim: UsageDimension, f: UsageFilter[]) => {
		const key = JSON.stringify([r.start, r.end ?? null, dim, f]);
		let rows = rankings.get(key);
		if (!rows) {
			rows = cached('byDimension', r, { dim, filters: f }, () =>
				orgUsageByDimension(r, dim, { ...scope, filters: f })
			);
			// the awaited and the streamed consumers each handle a failure; this
			// keeps the shared promise itself from surfacing as unhandled
			rows.catch(() => {});
			rankings.set(key, rows);
		}
		return rows;
	};

	// First-paint queries are dispatched before the secondary ones, so they are
	// first in line for pooled connections when the pool is contended.
	const firstPaint = Promise.all([
		cached('totals', range, { filters }, () => orgUsageTotals(range, { ...scope, filters })),
		ranked(range, groupBy, filters).then((rows) =>
			cached('seriesGrouped', range, { dim: groupBy, filters, bucket }, () =>
				orgUsageSeriesGrouped(range, groupBy, {
					...scope,
					unit: bucket,
					filters,
					limit: MAX_SERIES,
					ranked: rows
				})
			)
		),
		ranked(range, groupBy, filters).then((rows) => rows.slice(0, BREAKDOWN_LIMIT)),
		// flat series behind the headline sparklines — same window, same filters
		cached('series', range, { filters, bucket: unit }, () =>
			orgUsageSeries(range, { ...scope, unit, filters })
		)
	]);

	// Secondary panels: started now so they run alongside the first-paint
	// queries, but returned un-awaited.
	const secondary = {
		// previous equal-length window — powers the headline deltas, which don't
		// include latency. Filters carry over, or the comparison would be against
		// a differently-scoped population.
		prevTotals: streamed(
			cached('prevTotals', prevRange, { filters }, () =>
				orgUsageTotals(prevRange, { ...scope, filters, latency: false })
			),
			null,
			'prevTotals'
		),
		donuts: streamed(
			Promise.all(
				donutDims.map(async (dim) => ({
					dim,
					rows: (await ranked(range, dim, filters)).slice(0, 25)
				}))
			),
			[],
			'donuts'
		),
		// pickers are deliberately derived from the unfiltered window
		filterOptions: streamed(
			orgUsageFilterOptions(range, dimensions, {
				...scope,
				loadRanked: (dim) => ranked(range, dim, [])
			}),
			{} as UsageFilterOptions,
			'filterOptions'
		),
		meters: streamed(
			cached('meters', range, { filters }, () => orgTokenMeters(range, { ...scope, filters })),
			null,
			'meters'
		),
		// "what changed" is always measured on the grouping the operator picked,
		// so the answer lines up with the chart directly above it
		movers: streamed(
			Promise.all([ranked(range, groupBy, filters), ranked(prevRange, groupBy, filters)]).then(
				([current, previous]) =>
					orgTopMovers(range, prevRange, groupBy, { ...scope, filters, current, previous })
			),
			[],
			'movers'
		),
		efficiency: streamed(
			cached('efficiency', range, { filters }, () =>
				orgModelEfficiency(range, { ...scope, filters })
			),
			[],
			'efficiency'
		)
	};

	const [totals, grouped, breakdown, series] = await firstPaint;

	return {
		range: range.key,
		ranges: USAGE_RANGES,
		bucket,
		groupBy,
		filters,
		dimensions,
		breakdownLimit: BREAKDOWN_LIMIT,
		breakdownTruncated: breakdown.length >= BREAKDOWN_LIMIT,
		customFrom: request.customFrom,
		customTo: request.customTo,
		totals,
		grouped,
		breakdown,
		series,
		...secondary
	};
}
