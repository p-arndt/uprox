/**
 * Selectable time windows for the usage breakdowns, shared by the page (renders
 * the switcher) and the server (resolves a key to concrete dates). Presets are
 * either rolling windows (last N days/hours, ending now) or fixed UTC calendar
 * buckets (today, yesterday, this/last month, year-to-date). UTC is used
 * throughout so the windows line up with how the gateway and budget enforcement
 * bucket time (see budget.ts).
 */

export type UsageRangeKey =
	| 'today'
	| 'yesterday'
	| 'last-24h'
	| '7d'
	| '30d'
	| 'this-month'
	| 'last-month'
	| '90d'
	| 'ytd';

export interface UsageRangeOption {
	key: UsageRangeKey;
	label: string;
}

/** Order here is the order rendered in the switcher. */
export const USAGE_RANGES: readonly UsageRangeOption[] = [
	{ key: 'today', label: 'Today' },
	{ key: 'yesterday', label: 'Yesterday' },
	{ key: 'last-24h', label: 'Last 24h' },
	{ key: '7d', label: '7 days' },
	{ key: '30d', label: '30 days' },
	{ key: 'this-month', label: 'This month' },
	{ key: 'last-month', label: 'Last month' },
	{ key: '90d', label: '90 days' },
	{ key: 'ytd', label: 'Year to date' }
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
const HOUR_MS = 3_600_000;

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
 * (last-24h/7d/30d/90d) end at "now" and so omit `end`; calendar buckets carry
 * an exclusive `end`. `Date.UTC` with an out-of-range month rolls the year over,
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
		case 'last-24h':
			return { key: k, start: new Date(now.getTime() - DAY_MS) };
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
		case 'ytd':
			return { key: k, start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) };
		case '30d':
		default:
			return { key: '30d', start: new Date(now.getTime() - 30 * DAY_MS) };
	}
}

/**
 * The time-series bucket granularities, coarsest-last. `'auto'` lets the server
 * pick (see `chooseBucket`); the explicit units let an operator force a finer or
 * coarser shape than the default — e.g. hourly across a week, or monthly across a
 * year — subject to a bar-count cap so a wide window can't request thousands of
 * buckets (see `resolveSeriesBucket`).
 */
export type SeriesBucket = 'hour' | 'day' | 'week' | 'month';
export type BucketChoice = 'auto' | SeriesBucket;

export interface BucketOption {
	key: BucketChoice;
	label: string;
}

/** Order here is the order rendered in the granularity switcher. */
export const BUCKET_OPTIONS: readonly BucketOption[] = [
	{ key: 'auto', label: 'Auto' },
	{ key: 'hour', label: 'Hourly' },
	{ key: 'day', label: 'Daily' },
	{ key: 'week', label: 'Weekly' },
	{ key: 'month', label: 'Monthly' }
];

/** Coerce an arbitrary query value to a known bucket choice, defaulting to auto. */
export function normalizeBucket(value: string | null | undefined): BucketChoice {
	return BUCKET_OPTIONS.find((b) => b.key === value)?.key ?? 'auto';
}

/** Approximate width of one bucket, used only for the bar-count guard below. */
const BUCKET_MS: Record<SeriesBucket, number> = {
	hour: HOUR_MS,
	day: DAY_MS,
	week: 7 * DAY_MS,
	month: 30 * DAY_MS
};

/** Coarsest uncapped fallback order when a finer unit would draw too many bars. */
const COARSER: Record<SeriesBucket, SeriesBucket | null> = {
	hour: 'day',
	day: 'week',
	week: 'month',
	month: null
};

/**
 * Hard ceiling on the number of plotted buckets. A chart with thousands of bars
 * is both unreadable and a heavy `generate_series`; when a requested granularity
 * would exceed this we step to the next coarser unit until it fits.
 */
export const MAX_SERIES_BUCKETS = 750;

/**
 * Pick the time-series bucket granularity for a window when no explicit choice is
 * made: hourly for spans of two days or less (so "today"/"yesterday" and tight
 * custom windows get a useful intraday shape) and daily for everything wider.
 * Open-ended rolling windows measure their span against "now". Kept pure and
 * separate from the SQL so the decision is unit-testable.
 */
export function chooseBucket(range: ResolvedRange): 'hour' | 'day' {
	const span = (range.end ?? new Date()).getTime() - range.start.getTime();
	return span <= 2 * DAY_MS ? 'hour' : 'day';
}

/**
 * Resolve the effective series bucket for a window given the operator's choice.
 * `'auto'` defers to `chooseBucket`; an explicit unit is honoured unless it would
 * draw more than `MAX_SERIES_BUCKETS` bars, in which case it is stepped to the
 * next coarser unit until it fits. Pure and unit-testable.
 */
export function resolveSeriesBucket(
	range: ResolvedRange,
	choice: BucketChoice = 'auto'
): SeriesBucket {
	if (choice === 'auto') return chooseBucket(range);
	const span = (range.end ?? new Date()).getTime() - range.start.getTime();
	let unit: SeriesBucket = choice;
	while (span / BUCKET_MS[unit] > MAX_SERIES_BUCKETS) {
		const next = COARSER[unit];
		if (!next) break;
		unit = next;
	}
	return unit;
}

/**
 * The window immediately preceding `range`, of equal length — the baseline for
 * the "compare to previous period" overlay. Rolling windows are measured against
 * "now"; the returned range always carries an explicit exclusive `end` (it abuts
 * the current window's start) so it bounds cleanly. Keyed `'custom'` because it
 * is a derived, arbitrary window rather than a preset.
 */
export function shiftRangeBack(range: ResolvedRange): ResolvedRange {
	const end = range.start;
	const span = (range.end ?? new Date()).getTime() - range.start.getTime();
	return { key: 'custom', start: new Date(end.getTime() - span), end };
}
