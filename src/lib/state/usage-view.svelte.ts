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

import { goto, invalidateAll } from '$app/navigation';
import type { ResolvedPathname } from '$app/types';
import { buildUsageHref, type UsageUrlOverrides, type UsageUrlState } from '$lib/usage-url';
import type { UsageDimension, UsageFilter } from '$lib/usage-group';

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

/** Human label for the active window: the preset label or the custom bounds. */
export function usageRangeLabel(data: UsageViewData): string {
	return data.range === 'custom'
		? `${data.customFrom} – ${data.customTo}`
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
	const rangeLabel = $derived(usageRangeLabel(opts.data()));

	function current(): UsageUrlState {
		const d = opts.data();
		return {
			range: d.range,
			bucket: d.bucket,
			customFrom: d.customFrom,
			customTo: d.customTo,
			groupBy: d.groupBy,
			filters: d.filters
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
		// Re-runs the page load without a full reload; invalidateAll resolves once
		// the new data lands.
		async refresh() {
			if (refreshing) return;
			refreshing = true;
			try {
				await invalidateAll();
			} finally {
				refreshing = false;
			}
		},
		exportHref(exportPath, shape) {
			return buildUsageExportHref(exportPath, current(), shape) as ResolvedPathname;
		}
	};
}
