import { describe, it, expect } from 'vitest';
import { formatDateTime, relativeTime, formatUsd } from '$lib/format';

// `formatUsd` deliberately uses the runtime locale (toLocaleString), so the
// decimal separator is "." or "," depending on the machine. We assert with a
// `[.,]` class so the suite is stable in any locale while still pinning the
// digits and precision, which are the behaviour we care about.
describe('formatUsd', () => {
	it('renders null/undefined/zero as $0.00', () => {
		expect(formatUsd(null)).toMatch(/^\$0[.,]00$/);
		expect(formatUsd(undefined)).toMatch(/^\$0[.,]00$/);
		expect(formatUsd(0)).toMatch(/^\$0[.,]00$/);
	});

	it('keeps two minimum decimals for normal amounts', () => {
		expect(formatUsd(1.5)).toMatch(/^\$1[.,]50$/);
		expect(formatUsd(2.5)).toMatch(/^\$2[.,]50$/);
	});

	it('accepts numeric strings', () => {
		expect(formatUsd('3')).toMatch(/^\$3[.,]00$/);
		expect(formatUsd('0.42')).toMatch(/^\$0[.,]42$/);
	});

	it('widens precision to 6 digits for sub-cent amounts', () => {
		expect(formatUsd(0.005)).toMatch(/^\$0[.,]005$/);
	});

	it('widens precision to 8 digits for sub-$0.0001 amounts', () => {
		// a handful of nano-model tokens would round to $0.00 at 4 decimals
		expect(formatUsd(0.00005)).toMatch(/^\$0[.,]00005$/);
	});

	it('formats negatives with the sign after the dollar glyph', () => {
		expect(formatUsd(-1.5)).toMatch(/^\$-1[.,]50$/);
	});
});

describe('relativeTime', () => {
	const ago = (ms: number) => new Date(Date.now() - ms);

	it('returns "never" for nullish input', () => {
		expect(relativeTime(null)).toBe('never');
		expect(relativeTime(undefined)).toBe('never');
	});

	it('returns "just now" under a minute', () => {
		expect(relativeTime(ago(5_000))).toBe('just now');
	});

	it('returns minutes, hours, and days for the respective windows', () => {
		expect(relativeTime(ago(5 * 60_000))).toBe('5m ago');
		expect(relativeTime(ago(3 * 3_600_000))).toBe('3h ago');
		expect(relativeTime(ago(4 * 86_400_000))).toBe('4d ago');
	});

	it('falls back to an absolute date beyond ~30 days', () => {
		const out = relativeTime(ago(60 * 86_400_000));
		expect(out).not.toBe('never');
		expect(out).not.toMatch(/ago$/);
	});
});

describe('formatDateTime', () => {
	it('renders an em dash for nullish input', () => {
		expect(formatDateTime(null)).toBe('—');
		expect(formatDateTime(undefined)).toBe('—');
	});

	it('renders a non-empty string for a real date and accepts ISO strings', () => {
		const iso = '2026-05-27T13:45:00.000Z';
		expect(formatDateTime(iso)).not.toBe('—');
		expect(formatDateTime(new Date(iso)).length).toBeGreaterThan(0);
	});
});
