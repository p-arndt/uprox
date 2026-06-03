/**
 * Selectable time windows for the usage breakdowns, shared by the page (renders
 * the switcher) and the server (resolves a key to concrete dates). Presets are
 * either rolling windows (last N days, ending now) or fixed UTC calendar buckets
 * (today, yesterday, this/last month). UTC is used throughout so the windows line
 * up with how the gateway and budget enforcement bucket time (see budget.ts).
 */

export type UsageRangeKey =
	| 'today'
	| 'yesterday'
	| '7d'
	| '30d'
	| 'this-month'
	| 'last-month'
	| '90d';

export interface UsageRangeOption {
	key: UsageRangeKey;
	label: string;
}

/** Order here is the order rendered in the switcher. */
export const USAGE_RANGES: readonly UsageRangeOption[] = [
	{ key: 'today', label: 'Today' },
	{ key: 'yesterday', label: 'Yesterday' },
	{ key: '7d', label: '7 days' },
	{ key: '30d', label: '30 days' },
	{ key: 'this-month', label: 'This month' },
	{ key: 'last-month', label: 'Last month' },
	{ key: '90d', label: '90 days' }
];

export const DEFAULT_USAGE_RANGE: UsageRangeKey = '30d';

export interface ResolvedRange {
	key: UsageRangeKey;
	/** inclusive lower bound */
	start: Date;
	/** exclusive upper bound; omitted for windows that run up to "now" */
	end?: Date;
}

const DAY_MS = 86_400_000;

/** Coerce an arbitrary query value to a known range key, falling back to the default. */
export function normalizeRangeKey(key: string | null | undefined): UsageRangeKey {
	return USAGE_RANGES.find((r) => r.key === key)?.key ?? DEFAULT_USAGE_RANGE;
}

/**
 * Resolve a range key to a concrete `{ start, end? }` window. Rolling windows
 * (7d/30d/90d) end at "now" and so omit `end`; calendar buckets carry an
 * exclusive `end`. `Date.UTC` with an out-of-range month rolls the year over,
 * so "last month" works correctly in January.
 */
export function resolveUsageRange(key: string | null | undefined): ResolvedRange {
	const k = normalizeRangeKey(key);
	const now = new Date();
	const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

	switch (k) {
		case 'today':
			return { key: k, start: new Date(dayStart) };
		case 'yesterday':
			return { key: k, start: new Date(dayStart - DAY_MS), end: new Date(dayStart) };
		case '7d':
			return { key: k, start: new Date(now.getTime() - 7 * DAY_MS) };
		case '90d':
			return { key: k, start: new Date(now.getTime() - 90 * DAY_MS) };
		case 'this-month':
			return { key: k, start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
		case 'last-month':
			return {
				key: k,
				start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
				end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
			};
		case '30d':
		default:
			return { key: '30d', start: new Date(now.getTime() - 30 * DAY_MS) };
	}
}
