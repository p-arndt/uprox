import { describe, expect, it } from 'vitest';
import { expiryFromForm, KEEP_EXPIRY, recopyFromForm } from '$lib/server/token-actions';

const NOW = Date.parse('2026-01-01T00:00:00Z');
const DAY_MS = 86_400_000;

describe('expiryFromForm', () => {
	it('keeps the current expiry when the field is absent, blank or "keep"', () => {
		expect(expiryFromForm(null, NOW)).toBeUndefined();
		expect(expiryFromForm('', NOW)).toBeUndefined();
		expect(expiryFromForm(KEEP_EXPIRY, NOW)).toBeUndefined();
	});

	it('maps 0 (and garbage) to never expiring', () => {
		expect(expiryFromForm('0', NOW)).toBeNull();
		expect(expiryFromForm('-5', NOW)).toBeNull();
		expect(expiryFromForm('soon', NOW)).toBeNull();
	});

	it('counts days from now', () => {
		expect(expiryFromForm('30', NOW)).toEqual(new Date(NOW + 30 * DAY_MS));
		expect(expiryFromForm('365', NOW)).toEqual(new Date(NOW + 365 * DAY_MS));
	});
});

describe('recopyFromForm', () => {
	it('only reports switching re-copying off', () => {
		expect(recopyFromForm('false')).toBe(false);
		expect(recopyFromForm('true')).toBeUndefined();
		expect(recopyFromForm(null)).toBeUndefined();
	});
});
