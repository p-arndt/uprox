import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveUsageRange, normalizeRangeKey, USAGE_RANGES } from '$lib/usage-range';

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
