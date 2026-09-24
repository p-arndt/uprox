/**
 * Shared URL-state controller for the usage pages (org-wide usage, service
 * detail, token detail). Each of them round-trips its analysis window through
 * the query string; this owns the bookkeeping that was copy-pasted into all
 * three: the range label, href building, custom-range apply, group-by/filter
 * navigation, and the in-place refresh.
 *
 * Pages still call `resolve()` themselves and hand the result in through
 * `basePath`, so the navigation lint rule stays satisfied at the source.
 */

import { goto, replaceState } from '$app/navigation';
import { page } from '$app/state';
import type { ResolvedPathname } from '$app/types';
import {
	buildUsageHref,
	type UsageUrlOverrides,
	type UsageUrlState
} from '$lib/features/usage/url';
import type { UsageDimension, UsageFilter } from '$lib/features/usage/group';
import { normalizeMetric, type UsageMetric } from '$lib/features/usage/metric';
import { formatDayRange } from '$lib/features/usage/date-range';

/** The slice of a usage page's load data the controller reads. */
export interface UsageViewData {
	range: string;
	bucket: string;
	customFrom: string | null;
	customTo: string | null;
	groupBy: UsageDimension;
	filters: UsageFilter[];
	ranges: readonly { key: string; label: string }[];
}

export type UsageExportShape = 'breakdown' | 'timeseries';

/** Query param that makes the usage loader skip its query cache (the refresh button). */
export const FRESH_PARAM = 'fresh';

/** Human label for the active window: the preset label or the custom bounds. */
export function usageRangeLabel(data: UsageViewData): string {
	return data.range === 'custom'
		? formatDayRange(data.customFrom ?? '', data.customTo ?? '')
		: (data.ranges.find((r) => r.key === data.range)?.label ?? data.range);
}

/**
 * Href for the CSV export endpoint. The endpoint takes the page's own query
 * string plus a `shape`, so the download is exactly the view on screen.
 */
export function buildUsageExportHref(
	exportPath: string,
	current: UsageUrlState,
	shape: UsageExportShape
): string {
	return `${buildUsageHref(exportPath, current)}&shape=${shape}`;
}

export interface UsageView {
	readonly rangeLabel: string;
	readonly refreshing: boolean;
	/** the chart's plotted figure, round-tripped through `?metric=` */
	readonly metric: UsageMetric;
	/** true when any dimension filter is active */
	readonly filtered: boolean;
	setMetric(metric: UsageMetric): void;
	hrefWith(overrides: UsageUrlOverrides): ResolvedPathname;
	applyCustom(from: string, to: string): void;
	setGroupBy(dim: UsageDimension): void;
	setFilters(filters: UsageFilter[]): void;
	refresh(): Promise<void>;
	exportHref(exportPath: ResolvedPathname, shape: UsageExportShape): ResolvedPathname;
}

export function createUsageView(opts: {
	/** reactive load data (pass a getter so updates flow through) */
	data: () => UsageViewData;
	/** the page's already-resolved base path */
	basePath: () => string;
}): UsageView {
	let refreshing = $state(false);
	// Seeded from the URL, then owned here: switching the metric only redraws
	// the chart, so it updates the address bar shallowly instead of navigating,
	// which would re-run the whole load for a change the server never sees.
	let metric = $state<UsageMetric>(normalizeMetric(page.url.searchParams.get('metric')));
	const rangeLabel = $derived(usageRangeLabel(opts.data()));

	function current(): UsageUrlState {
		const d = opts.data();
		return {
			range: d.range,
			bucket: d.bucket,
			customFrom: d.customFrom,
			customTo: d.customTo,
			groupBy: d.groupBy,
			filters: d.filters,
			metric
		};
	}

	function hrefWith(overrides: UsageUrlOverrides): ResolvedPathname {
		return buildUsageHref(opts.basePath(), current(), overrides) as ResolvedPathname;
	}

	return {
		get rangeLabel() {
			return rangeLabel;
		},
		get refreshing() {
			return refreshing;
		},
		get metric() {
			return metric;
		},
		get filtered() {
			return opts.data().filters.length > 0;
		},
		setMetric(next) {
			metric = next;
			replaceState(hrefWith({}), page.state);
		},
		hrefWith,
		applyCustom(from, to) {
			goto(hrefWith({ range: 'custom', from, to }), { noScroll: true });
		},
		// Group-by and filters are URL state, so every change is a navigation —
		// which also makes Back walk the analysis history rather than leaving the page.
		setGroupBy(dim) {
			goto(hrefWith({ groupBy: dim }), { noScroll: true, keepFocus: true });
		},
		setFilters(filters) {
			goto(hrefWith({ filters }), { noScroll: true, keepFocus: true });
		},
		// Re-runs the page load without a full reload. `fresh=1` tells the loader
		// to skip its query cache, so a refresh always shows current figures; the
		// param is stripped from the address bar again once the data lands, so a
		// later reload or a copied link goes back to using the cache.
		async refresh() {
			if (refreshing) return;
			refreshing = true;
			try {
				const href = hrefWith({});
				await goto(`${href}&${FRESH_PARAM}=1` as ResolvedPathname, {
					replaceState: true,
					noScroll: true,
					keepFocus: true,
					invalidateAll: true
				});
				replaceState(href, page.state);
			} finally {
				refreshing = false;
			}
		},
		exportHref(exportPath, shape) {
			return buildUsageExportHref(exportPath, current(), shape) as ResolvedPathname;
		}
	};
}

/**
 * Reactive view of the latest value of a streamed promise: `undefined` while
 * the current promise is pending, then its value. When the source hands over a
 * new promise (a navigation re-ran the load), the old one is ignored even if it
 * settles later, so a slow earlier response can never overwrite newer data.
 */
export function latest<T>(source: () => Promise<T> | undefined): {
	readonly current: T | undefined;
} {
	let current = $state<T | undefined>(undefined);
	$effect(() => {
		const promise = source();
		let active = true;
		current = undefined;
		promise?.then((value) => {
			if (active) current = value;
		});
		return () => {
			active = false;
		};
	});
	return {
		get current() {
			return current;
		}
	};
}
