/**
 * Client-safe URL builder shared by the usage, service-detail, and token-detail
 * pages. Each page's range/granularity controls navigate by href so the window
 * survives a reload and is shareable; this helper centralizes the
 * preserve-the-other-params logic (range + bucket + custom from/to) that was
 * triplicated as a per-page `hrefWith`. Callers pass their already-`resolve()`d
 * base path and cast the result back to `ResolvedPathname` at the call site, so
 * the navigation lint rule stays satisfied.
 */

import {
	DEFAULT_GROUP_BY,
	serializeFilters,
	type UsageDimension,
	type UsageFilter
} from '$lib/usage-group';

/** The window params a usage page round-trips through the query string. */
export interface UsageUrlState {
	range: string;
	bucket: string;
	/** inclusive custom-range bounds (YYYY-MM-DD), only meaningful when range === 'custom' */
	customFrom: string | null;
	customTo: string | null;
	/** the dimension the chart/donuts split by; omitted on the non-analysis pages */
	groupBy?: UsageDimension;
	/** active dimension filters; omitted on the non-analysis pages */
	filters?: UsageFilter[];
}

export interface UsageUrlOverrides {
	range?: string;
	bucket?: string;
	from?: string | null;
	to?: string | null;
	groupBy?: UsageDimension;
	/** replaces the whole filter set — pass `[]` to clear it */
	filters?: UsageFilter[];
}

/**
 * Build `${basePath}?…` preserving whichever of range/bucket/custom-bounds the
 * caller isn't explicitly overriding. `bucket === 'auto'` and a non-custom range
 * drop their params so the default URL stays clean.
 */
export function buildUsageHref(
	basePath: string,
	current: UsageUrlState,
	overrides: UsageUrlOverrides = {}
): string {
	const p = new URLSearchParams();
	const range = overrides.range ?? current.range;
	p.set('range', range);
	if (range === 'custom') {
		const from = overrides.from ?? current.customFrom;
		const to = overrides.to ?? current.customTo;
		if (from) p.set('from', from);
		if (to) p.set('to', to);
	}
	const bucket = overrides.bucket ?? current.bucket;
	if (bucket && bucket !== 'auto') p.set('bucket', bucket);

	// Analysis params. Both are omitted at their defaults so the plain
	// /app/usage URL stays clean, and so the pages that don't group (service and
	// token detail) never grow params they'd ignore on the way back in.
	const groupBy = overrides.groupBy ?? current.groupBy;
	if (groupBy && groupBy !== DEFAULT_GROUP_BY) p.set('group', groupBy);

	const filters = overrides.filters ?? current.filters;
	// one repeated `f=<dim>:<value>` per value — see parseFilters for why
	for (const entry of serializeFilters(filters ?? [])) p.append('f', entry);

	return `${basePath}?${p}`;
}
