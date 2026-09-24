import { describe, expect, it } from 'vitest';
import { formatDayRange, formatWindow } from '$lib/features/usage/date-range';

// ICU separates range parts with thin/narrow spaces; compare on plain spaces.
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('formatDayRange', () => {
	it('collapses a range inside one month', () => {
		expect(plain(formatDayRange('2026-01-01', '2026-01-31', 'en-US'))).toBe('Jan 1 – 31, 2026');
	});

	it('spells out both ends across years', () => {
		expect(plain(formatDayRange('2025-12-20', '2026-01-05', 'en-US'))).toBe(
			'Dec 20, 2025 – Jan 5, 2026'
		);
	});

	it('shows a single day once', () => {
		expect(formatDayRange('2026-03-04', '2026-03-04', 'en-US')).toBe('Mar 4, 2026');
	});

	it('stays on the UTC calendar day', () => {
		expect(formatDayRange('2026-01-01', '2026-01-01', 'en-US')).toBe('Jan 1, 2026');
	});

	it('falls back to the raw values when malformed', () => {
		expect(formatDayRange('nope', '2026-01-01', 'en-US')).toBe('nope – 2026-01-01');
	});
});

describe('formatWindow', () => {
	it('reads a day-aligned window as its inclusive days', () => {
		expect(
			plain(formatWindow('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'en-US'))
		).toBe('Aug 1 – 31, 2026');
	});

	it('reads a one-day window as that day', () => {
		expect(formatWindow('2026-09-23T00:00:00.000Z', '2026-09-24T00:00:00.000Z', 'en-US')).toBe(
			'Sep 23, 2026'
		);
	});

	it('includes the time of day for a rolling window', () => {
		const out = plain(
			formatWindow('2026-09-22T14:05:00.000Z', '2026-09-23T14:05:00.000Z', 'en-US')
		);
		expect(out).toContain('2:05');
		expect(out).toMatch(/Sep 22.*Sep 23/);
		expect(out.endsWith('UTC')).toBe(true);
	});

	it('is empty for unparseable input', () => {
		expect(formatWindow('x', 'y')).toBe('');
	});
});
