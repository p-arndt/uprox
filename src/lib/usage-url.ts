/**
 * Client-safe URL builder shared by the usage, service-detail, and token-detail
 * pages. Each page's range/granularity controls navigate by href so the window
 * survives a reload and is shareable; this helper centralizes the
 * preserve-the-other-params logic (range + bucket + custom from/to) that was
 * triplicated as a per-page `hrefWith`. Callers pass their already-`resolve()`d
 * base path and cast the result back to `ResolvedPathname` at the call site, so
 * the navigation lint rule stays satisfied.
 */

/** The window params a usage page round-trips through the query string. */
export interface UsageUrlState {
	range: string;
	bucket: string;
	/** inclusive custom-range bounds (YYYY-MM-DD), only meaningful when range === 'custom' */
	customFrom: string | null;
	customTo: string | null;
}

export interface UsageUrlOverrides {
	range?: string;
	bucket?: string;
	from?: string | null;
	to?: string | null;
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
	return `${basePath}?${p}`;
}
