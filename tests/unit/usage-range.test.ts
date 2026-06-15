import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	resolveUsageRange,
	normalizeRangeKey,
	normalizeBucket,
	chooseBucket,
	resolveSeriesBucket,
	shiftRangeBack,
	MAX_SERIES_BUCKETS,
	USAGE_RANGES
} from '$lib/usage-range';

// Pin "now" to a mid-month, mid-day UTC instant so calendar buckets are
// unambiguous. June has 30 days; the surrounding months let us check rollover.
const NOW = new Date('2026-06-15T12:34:56.000Z');

describe('resolveUsageRange', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('falls back to the default (30d) for unknown or missing keys', () => {
		expect(resolveUsageRange(undefined).key).toBe('30d');
		expect(resolveUsageRange(null).key).toBe('30d');
		expect(resolveUsageRange('nonsense').key).toBe('30d');
	});

	it('"today" starts at 00:00 UTC and runs to now (no end)', () => {
		const r = resolveUsageRange('today');
		expect(r.start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
		expect(r.end).toBeUndefined();
	});

	it('"yesterday" is the full previous UTC day, bounded above', () => {
		const r = resolveUsageRange('yesterday');
		expect(r.start.toISOString()).toBe('2026-06-14T00:00:00.000Z');
		expect(r.end?.toISOString()).toBe('2026-06-15T00:00:00.000Z');
	});

	it('rolling windows end at now and carry no upper bound', () => {
		const sevenDays = resolveUsageRange('7d');
		expect(sevenDays.start.toISOString()).toBe('2026-06-08T12:34:56.000Z');
		expect(sevenDays.end).toBeUndefined();
		expect(resolveUsageRange('90d').start.toISOString()).toBe('2026-03-17T12:34:56.000Z');
	});

	it('"last-24h" is a rolling 24-hour window ending now', () => {
		const r = resolveUsageRange('last-24h');
		expect(r.start.toISOString()).toBe('2026-06-14T12:34:56.000Z');
		expect(r.end).toBeUndefined();
	});

	it('"ytd" starts at Jan 1 00:00 UTC of the current year', () => {
		const r = resolveUsageRange('ytd');
		expect(r.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
		expect(r.end).toBeUndefined();
	});

	it('"this-month" starts at the 1st 00:00 UTC', () => {
		const r = resolveUsageRange('this-month');
		expect(r.start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
		expect(r.end).toBeUndefined();
	});

	it('"last-month" spans the previous calendar month, exclusive upper bound', () => {
		const r = resolveUsageRange('last-month');
		expect(r.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
		expect(r.end?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
	});

	it('rolls the year over for "last-month" in January', () => {
		vi.setSystemTime(new Date('2026-01-10T08:00:00.000Z'));
		const r = resolveUsageRange('last-month');
		expect(r.start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
		expect(r.end?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
	});

	it('"custom" spans from 00:00 UTC of `from` to the exclusive end of `to`', () => {
		const r = resolveUsageRange('custom', { from: '2026-06-03', to: '2026-06-09' });
		expect(r.key).toBe('custom');
		expect(r.start.toISOString()).toBe('2026-06-03T00:00:00.000Z');
		// exclusive upper bound = the day *after* `to`, so the whole 9th is included
		expect(r.end?.toISOString()).toBe('2026-06-10T00:00:00.000Z');
	});

	it('"custom" swaps out-of-order bounds', () => {
		const r = resolveUsageRange('custom', { from: '2026-06-09', to: '2026-06-03' });
		expect(r.start.toISOString()).toBe('2026-06-03T00:00:00.000Z');
		expect(r.end?.toISOString()).toBe('2026-06-10T00:00:00.000Z');
	});

	it('"custom" falls back to the default when a bound is missing or malformed', () => {
		expect(resolveUsageRange('custom', { from: '2026-06-03', to: null }).key).toBe('30d');
		expect(resolveUsageRange('custom', { from: 'nonsense', to: '2026-06-09' }).key).toBe('30d');
		expect(resolveUsageRange('custom', { from: '2026-02-30', to: '2026-06-09' }).key).toBe('30d');
		expect(resolveUsageRange('custom').key).toBe('30d');
	});
});

describe('chooseBucket', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('buckets short windows (<= 2 days) hourly', () => {
		expect(chooseBucket(resolveUsageRange('today'))).toBe('hour');
		expect(chooseBucket(resolveUsageRange('yesterday'))).toBe('hour');
		// a one-day custom window
		expect(
			chooseBucket(resolveUsageRange('custom', { from: '2026-06-03', to: '2026-06-03' }))
		).toBe('hour');
	});

	it('buckets wider windows daily', () => {
		expect(chooseBucket(resolveUsageRange('7d'))).toBe('day');
		expect(chooseBucket(resolveUsageRange('30d'))).toBe('day');
		expect(chooseBucket(resolveUsageRange('90d'))).toBe('day');
		expect(
			chooseBucket(resolveUsageRange('custom', { from: '2026-06-01', to: '2026-06-09' }))
		).toBe('day');
	});
});

describe('resolveSeriesBucket', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('defers to chooseBucket for "auto"', () => {
		expect(resolveSeriesBucket(resolveUsageRange('today'), 'auto')).toBe('hour');
		expect(resolveSeriesBucket(resolveUsageRange('30d'), 'auto')).toBe('day');
		// missing choice defaults to auto
		expect(resolveSeriesBucket(resolveUsageRange('30d'))).toBe('day');
	});

	it('honours an explicit unit when it fits the bar-count cap', () => {
		expect(resolveSeriesBucket(resolveUsageRange('7d'), 'hour')).toBe('hour');
		expect(resolveSeriesBucket(resolveUsageRange('90d'), 'week')).toBe('week');
		expect(resolveSeriesBucket(resolveUsageRange('ytd'), 'month')).toBe('month');
	});

	it('steps a too-fine unit to the next coarser one past the cap', () => {
		// hourly across 90 days would be ~2160 bars, well over the cap
		expect(MAX_SERIES_BUCKETS).toBeLessThan(2160);
		expect(resolveSeriesBucket(resolveUsageRange('90d'), 'hour')).toBe('day');
		// hourly across a year cascades hour -> day -> ... but daily (~365) fits
		expect(resolveSeriesBucket(resolveUsageRange('ytd'), 'hour')).toBe('day');
	});
});

describe('shiftRangeBack', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns the equal-length window immediately before a bounded range', () => {
		const r = resolveUsageRange('yesterday');
		const prev = shiftRangeBack(r);
		// abuts the current window's start and is one day long
		expect(prev.end?.toISOString()).toBe(r.start.toISOString());
		expect(prev.start.toISOString()).toBe('2026-06-13T00:00:00.000Z');
	});

	it('measures rolling windows against now', () => {
		const r = resolveUsageRange('7d'); // start = now - 7d, open-ended
		const prev = shiftRangeBack(r);
		expect(prev.end?.toISOString()).toBe(r.start.toISOString());
		expect(prev.start.toISOString()).toBe('2026-06-01T12:34:56.000Z');
	});
});

describe('normalizeBucket', () => {
	it('passes through known bucket choices', () => {
		for (const k of ['auto', 'hour', 'day', 'week', 'month'] as const) {
			expect(normalizeBucket(k)).toBe(k);
		}
	});
	it('coerces anything else to auto', () => {
		expect(normalizeBucket('')).toBe('auto');
		expect(normalizeBucket('minute')).toBe('auto');
		expect(normalizeBucket(null)).toBe('auto');
	});
});

describe('normalizeRangeKey', () => {
	it('passes through every known key', () => {
		for (const r of USAGE_RANGES) expect(normalizeRangeKey(r.key)).toBe(r.key);
	});
	it('coerces anything else to the default', () => {
		expect(normalizeRangeKey('')).toBe('30d');
		expect(normalizeRangeKey('7days')).toBe('30d');
	});
});
