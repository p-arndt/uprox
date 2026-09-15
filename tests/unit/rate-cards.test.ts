import { describe, expect, it } from 'vitest';
import { meterRatesFor, ratesFor } from '$lib/server/usage-queries/rate-cards';
import type { ModelPrice } from '$lib/server/providers';

const prices: Record<string, ModelPrice> = {
	'gpt-5.4': { in: 2.5, out: 15, cacheRead: 0.25, cacheWrite: 2.5, longIn: 5, longOut: 22.5 },
	'gpt-5.4-mini': { in: 0.75, out: 4.5, cacheRead: 0.075 },
	o3: { in: 2, out: 8 }
};

describe('ratesFor', () => {
	it('uses an exact match', () => {
		expect(ratesFor(prices, 'o3', 'standard')).toEqual({
			inputPerMtok: 2,
			outputPerMtok: 8,
			cacheReadPerMtok: null,
			cacheWritePerMtok: null
		});
	});

	it('resolves the longest prefix, case-insensitively', () => {
		expect(ratesFor(prices, 'GPT-5.4-mini-2026', null)?.inputPerMtok).toBe(0.75);
		expect(ratesFor(prices, 'gpt-5.4-2026', null)?.inputPerMtok).toBe(2.5);
	});

	it('returns null for no model or an unpriced model', () => {
		expect(ratesFor(prices, null, 'long')).toBeNull();
		expect(ratesFor(prices, 'claude-opus-5', 'standard')).toBeNull();
	});

	it('picks the long card only for long-tier groups of long-card models', () => {
		expect(ratesFor(prices, 'gpt-5.4', 'long')).toEqual({
			inputPerMtok: 5,
			outputPerMtok: 22.5,
			// unset long cache rates stay unset so the multiplier fallback applies
			cacheReadPerMtok: null,
			cacheWritePerMtok: null
		});
		expect(ratesFor(prices, 'gpt-5.4', 'standard')?.inputPerMtok).toBe(2.5);
		// a single-card model bills standard even when the row says long
		expect(ratesFor(prices, 'gpt-5.4-mini', 'long')?.inputPerMtok).toBe(0.75);
	});
});

describe('meterRatesFor', () => {
	it('falls back to the standard output rate when the long card leaves it unset', () => {
		expect(meterRatesFor({ in: 1, out: 4, longIn: 2 }, 'long')).toEqual({
			inputPerMtok: 2,
			outputPerMtok: 4,
			cacheReadPerMtok: null,
			cacheWritePerMtok: null
		});
	});
});
