/**
 * The grouping/filtering vocabulary shared by the usage page, its URL, and the
 * server queries — the "Group by" and "Add filter" halves of the cost-analysis
 * toolbar.
 *
 * Client-safe by construction: a dimension is an opaque key here, and only
 * `server/data.ts` maps that key onto a real column. Nothing in this module ever
 * reaches SQL, so an attacker-supplied `group=` or `f=` value can at worst fail
 * to match a known key and fall back to the default.
 */

/** The dimensions traffic can be sliced by. Order is the order rendered. */
export const USAGE_DIMENSIONS = [
	{ key: 'service', label: 'Service', plural: 'Services' },
	{ key: 'model', label: 'Model', plural: 'Models' },
	{ key: 'provider', label: 'Provider', plural: 'Providers' },
	{ key: 'token', label: 'Machine token', plural: 'Machine tokens' },
	{ key: 'status', label: 'Status', plural: 'Statuses' },
	{ key: 'meter', label: 'Token meter', plural: 'Token meters' }
] as const;

export type UsageDimension = (typeof USAGE_DIMENSIONS)[number]['key'];

/**
 * Model is the default slice: it's the dimension that actually explains a bill.
 * Two services can spend identically and be doing completely different things,
 * whereas a jump in spend almost always traces to which model served the
 * traffic — and it's the one dimension every scope (org, service, token) shares.
 */
export const DEFAULT_GROUP_BY: UsageDimension = 'model';

/**
 * Dimensions that can be *filtered* on, which is a strict subset of those that
 * can be grouped by. `meter` is groupable but not filterable: a meter is a slice
 * of a request's token counts, not a property of the request, so one row feeds
 * several meters at once and "where meter = output" has no meaning in SQL.
 */
export const FILTERABLE_DIMENSIONS = USAGE_DIMENSIONS.filter((d) => d.key !== 'meter').map(
	(d) => d.key
) as readonly UsageDimension[];

export function isFilterableDimension(value: unknown): value is UsageDimension {
	return isUsageDimension(value) && FILTERABLE_DIMENSIONS.includes(value);
}

const DIMENSION_KEYS = USAGE_DIMENSIONS.map((d) => d.key) as readonly string[];

export function isUsageDimension(value: unknown): value is UsageDimension {
	return typeof value === 'string' && DIMENSION_KEYS.includes(value);
}

/** Coerce an arbitrary query value to a known dimension, else the default. */
export function normalizeGroupBy(value: string | null | undefined): UsageDimension {
	return isUsageDimension(value) ? value : DEFAULT_GROUP_BY;
}

export function dimensionLabel(dim: UsageDimension): string {
	return USAGE_DIMENSIONS.find((d) => d.key === dim)?.label ?? dim;
}

/**
 * One filter clause: a dimension narrowed to a set of values, OR-ed within the
 * dimension and AND-ed across dimensions (the behaviour Azure's filter pills
 * have, and the one people expect — "service A or B, but only model X").
 */
export interface UsageFilter {
	dim: UsageDimension;
	values: string[];
}

/**
 * The sentinel standing in for "the grouping column was NULL" — a request whose
 * service was since deleted, or one denied before a model was ever resolved.
 * Real ids are uuids and real model names are non-empty, so this can't collide.
 */
export const NULL_VALUE = '__none__';

/** The synthetic series holding everything past the top-N cut. Never filterable. */
export const OTHERS_KEY = '__others__';

/* --------------------------- url  <->  filter list --------------------------- */

/**
 * Filters travel as repeated `f=<dim>:<value>` params — one entry per value, so
 * a value containing a comma or colon survives the round trip untouched (only
 * the FIRST colon separates dimension from value). Repeated params rather than
 * one packed string keeps them readable in the address bar and lets the browser
 * do the escaping.
 */
export function parseFilters(raw: string[]): UsageFilter[] {
	const byDim = new Map<UsageDimension, string[]>();
	for (const entry of raw) {
		const sep = entry.indexOf(':');
		if (sep <= 0) continue;
		const dim = entry.slice(0, sep);
		const value = entry.slice(sep + 1);
		// non-filterable dimensions (meter) can't produce a SQL predicate
		if (!isFilterableDimension(dim) || value === '') continue;
		const list = byDim.get(dim) ?? [];
		// de-dupe so a hand-edited URL can't inflate the IN-list
		if (!list.includes(value)) list.push(value);
		byDim.set(dim, list);
	}
	// emit in USAGE_DIMENSIONS order so the pills render stably regardless of
	// the order the params happened to arrive in
	return USAGE_DIMENSIONS.filter((d) => byDim.has(d.key)).map((d) => ({
		dim: d.key,
		values: byDim.get(d.key)!
	}));
}

/** The inverse of {@link parseFilters} — flattens back to `f` param values. */
export function serializeFilters(filters: UsageFilter[]): string[] {
	return filters.flatMap((f) => f.values.map((v) => `${f.dim}:${v}`));
}

/** Add a value to a dimension's clause (creating it if absent), immutably. */
export function addFilterValue(
	filters: UsageFilter[],
	dim: UsageDimension,
	value: string
): UsageFilter[] {
	const existing = filters.find((f) => f.dim === dim);
	if (!existing) return [...filters, { dim, values: [value] }];
	if (existing.values.includes(value)) return filters;
	return filters.map((f) => (f.dim === dim ? { ...f, values: [...f.values, value] } : f));
}

/** Remove a single value, dropping the clause entirely once it empties. */
export function removeFilterValue(
	filters: UsageFilter[],
	dim: UsageDimension,
	value: string
): UsageFilter[] {
	return filters
		.map((f) => (f.dim === dim ? { ...f, values: f.values.filter((v) => v !== value) } : f))
		.filter((f) => f.values.length > 0);
}

export function countFilterValues(filters: UsageFilter[]): number {
	return filters.reduce((n, f) => n + f.values.length, 0);
}

/* ------------------------------ filter options ------------------------------- */

/**
 * A selectable value for a dimension, as offered by the "Add filter" popover.
 * The server derives these from the traffic actually present in the window, so
 * the picker never lists a service that hasn't called the gateway.
 */
export interface UsageFilterOption {
	value: string;
	label: string;
	/** secondary line — e.g. the service a token belongs to */
	hint?: string | null;
}

export type UsageFilterOptions = Record<UsageDimension, UsageFilterOption[]>;
