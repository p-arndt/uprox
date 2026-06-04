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

/**
 * Resolved-range keys cover the presets above plus `'custom'`, which is driven by
 * explicit `from`/`to` query params rather than a switcher button (so it is
 * deliberately absent from `USAGE_RANGES`).
 */
export type ResolvedRangeKey = UsageRangeKey | 'custom';

export interface ResolvedRange {
	key: ResolvedRangeKey;
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

/** Match `YYYY-MM-DD` and pull out the parts. */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a `YYYY-MM-DD` calendar date to the UTC instant at its 00:00, or `null`
 * if the string is missing or malformed. Validates via round-trip so impossible
 * dates ("2026-02-30") are rejected rather than silently rolled over.
 */
function parseUtcDate(value: string | null | undefined): Date | null {
	const m = value?.match(DATE_RE);
	if (!m) return null;
	const [, y, mo, d] = m;
	const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
	const dt = new Date(ms);
	// reject rolled-over values (e.g. month 13, day 32) by checking the round trip
	if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1) return null;
	return dt;
}

export interface CustomRangeInput {
	from?: string | null;
	to?: string | null;
}

/**
 * Resolve a range key to a concrete `{ start, end? }` window. Rolling windows
 * (7d/30d/90d) end at "now" and so omit `end`; calendar buckets carry an
 * exclusive `end`. `Date.UTC` with an out-of-range month rolls the year over,
 * so "last month" works correctly in January.
 *
 * `key === 'custom'` reads the `from`/`to` calendar dates from `custom`: `start`
 * is `from` at 00:00 UTC and `end` is the day *after* `to` at 00:00 UTC, so the
 * whole `to` day is included (the same exclusive-upper convention as "yesterday"
 * and "last month"). Out-of-order dates are swapped; a missing or malformed
 * date falls back to the default preset.
 */
export function resolveUsageRange(
	key: string | null | undefined,
	custom?: CustomRangeInput
): ResolvedRange {
	if (key === 'custom') {
		let start = parseUtcDate(custom?.from);
		let end = parseUtcDate(custom?.to);
		if (start && end) {
			if (start.getTime() > end.getTime()) [start, end] = [end, start];
			return { key: 'custom', start, end: new Date(end.getTime() + DAY_MS) };
		}
		// fall through to the default window when either bound is unusable
	}

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

/**
 * Pick the time-series bucket granularity for a window: hourly for spans of two
 * days or less (so "today"/"yesterday" and tight custom windows get a useful
 * intraday shape) and daily for everything wider. Open-ended rolling windows
 * measure their span against "now". Kept pure and separate from the SQL so the
 * decision is unit-testable.
 */
export function chooseBucket(range: ResolvedRange): 'hour' | 'day' {
	const span = (range.end ?? new Date()).getTime() - range.start.getTime();
	return span <= 2 * DAY_MS ? 'hour' : 'day';
}
