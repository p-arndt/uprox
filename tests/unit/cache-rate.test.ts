import { describe, it, expect } from 'vitest';
import { cacheRate } from '$lib/cache-rate';

describe('cacheRate', () => {
	it('computes provider cache reads over cacheable input', () => {
		const { rate } = cacheRate({
			inputTokens: 1000,
			embeddingInputTokens: 0,
			savedInputTokens: 0,
			providerCachedTokens: 750
		});
		expect(rate).toBeCloseTo(0.75);
	});

	it('excludes embedding input from the denominator (never cacheable)', () => {
		// 750 cached out of 1000 cacheable input, plus 3000 embedding tokens that
		// must not dilute the rate.
		const { rate, cacheableInput } = cacheRate({
			inputTokens: 4000,
			embeddingInputTokens: 3000,
			savedInputTokens: 0,
			providerCachedTokens: 750
		});
		expect(cacheableInput).toBe(1000);
		expect(rate).toBeCloseTo(0.75);
	});

	it("folds in uprox's own response-cache replays on both sides", () => {
		// 200 provider reads + 300 uprox-replayed over (800 upstream + 300 replayed)
		const { rate, cachedInput, cacheableInput } = cacheRate({
			inputTokens: 800,
			embeddingInputTokens: 0,
			savedInputTokens: 300,
			providerCachedTokens: 200
		});
		expect(cachedInput).toBe(500);
		expect(cacheableInput).toBe(1100);
		expect(rate).toBeCloseTo(500 / 1100);
	});

	it('returns 0 when there is no cacheable input', () => {
		expect(
			cacheRate({
				inputTokens: 0,
				embeddingInputTokens: 0,
				savedInputTokens: 0,
				providerCachedTokens: 0
			}).rate
		).toBe(0);
		// pure embedding traffic — denominator collapses to 0, not negative
		expect(
			cacheRate({
				inputTokens: 5000,
				embeddingInputTokens: 5000,
				savedInputTokens: 0,
				providerCachedTokens: 0
			}).rate
		).toBe(0);
	});
});
