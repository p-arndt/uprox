import { describe, it, expect } from 'vitest';
import {
	splitMeters,
	meterListCosts,
	providerCacheSaving,
	allocateCost,
	sumMeterValues,
	effectiveRatePerMtok,
	emptyMeterValues,
	METER_ORDER,
	type MeterRates,
	type MeterTokenSums
} from '$lib/usage-meters';

/**
 * These are the figures an operator reconciles an invoice against, so the
 * properties worth pinning down are the ones a bill has to satisfy: the parts
 * add up to the whole, and the parts add up to the *recorded* total rather than
 * to whatever the current rate card would imply.
 */

const sums = (over: Partial<MeterTokenSums> = {}): MeterTokenSums => ({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	embeddingInputTokens: 0,
	embeddingOutputTokens: 0,
	...over
});

// $10 in, $50 out, cache read/write left NULL so the fallback multipliers apply
const rates: MeterRates = {
	inputPerMtok: 10,
	outputPerMtok: 50,
	cacheReadPerMtok: null,
	cacheWritePerMtok: null
};

describe('splitMeters', () => {
	it('carves cache read and write out of the prompt', () => {
		const t = splitMeters(
			sums({ inputTokens: 1000, cacheReadTokens: 600, cacheWriteTokens: 100, outputTokens: 200 })
		);
		expect(t.input).toBe(300);
		expect(t.cacheRead).toBe(600);
		expect(t.cacheWrite).toBe(100);
		expect(t.output).toBe(200);
	});

	it('partitions the volume exactly — the meters sum to the tokens billed', () => {
		const s = sums({
			inputTokens: 1000,
			cacheReadTokens: 600,
			cacheWriteTokens: 100,
			outputTokens: 200,
			embeddingInputTokens: 5000,
			embeddingOutputTokens: 7
		});
		const total = s.inputTokens + s.outputTokens + s.embeddingInputTokens + s.embeddingOutputTokens;
		expect(sumMeterValues(splitMeters(s))).toBe(total);
	});

	it('clamps rather than going negative when upstream over-reports a cache hit', () => {
		// A malformed usage block claiming more cached tokens than prompt tokens
		// must not drive the fresh-input meter below zero.
		const t = splitMeters(sums({ inputTokens: 100, cacheReadTokens: 400 }));
		expect(t.input).toBe(0);
	});

	it('meters embeddings as one line covering both halves', () => {
		const t = splitMeters(sums({ embeddingInputTokens: 900, embeddingOutputTokens: 100 }));
		expect(t.embedding).toBe(1000);
		expect(t.input).toBe(0);
		expect(t.output).toBe(0);
	});
});

describe('meterListCosts', () => {
	it('prices each meter at its own rate, with the cache fallbacks', () => {
		const c = meterListCosts(
			sums({
				inputTokens: 1_000_000,
				cacheReadTokens: 1_000_000,
				cacheWriteTokens: 1_000_000,
				outputTokens: 1_000_000
			}),
			rates
		);
		// fresh input is 1M prompt minus the 2M cached halves, clamped to zero
		expect(c.input).toBe(0);
		expect(c.cacheRead).toBeCloseTo(1); // 10 x 0.1
		expect(c.cacheWrite).toBeCloseTo(12.5); // 10 x 1.25
		expect(c.output).toBeCloseTo(50);
	});

	it('honours explicit cache rates over the fallback multipliers', () => {
		const c = meterListCosts(sums({ inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }), {
			...rates,
			cacheReadPerMtok: 3
		});
		expect(c.cacheRead).toBeCloseTo(3);
	});

	it('blends the two halves of an embedding line', () => {
		const c = meterListCosts(
			sums({ embeddingInputTokens: 1_000_000, embeddingOutputTokens: 1_000_000 }),
			rates
		);
		expect(c.embedding).toBeCloseTo(60);
	});

	it('costs an unpriced model at nothing rather than guessing', () => {
		expect(meterListCosts(sums({ inputTokens: 5_000_000 }), null)).toEqual(emptyMeterValues());
	});
});

describe('providerCacheSaving', () => {
	it('prices the gap between the full input rate and the cache-read rate', () => {
		// 1M cache reads at 10 - 1 = 9 per Mtok avoided
		expect(providerCacheSaving(sums({ cacheReadTokens: 1_000_000 }), rates)).toBeCloseTo(9);
	});

	it('never reports a negative saving when a cache read costs more than input', () => {
		const saving = providerCacheSaving(sums({ cacheReadTokens: 1_000_000 }), {
			...rates,
			cacheReadPerMtok: 40
		});
		expect(saving).toBe(0);
	});
});

describe('allocateCost', () => {
	const tokens = splitMeters(sums({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
	const list = meterListCosts(sums({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), rates);

	it('scales the list split onto the spend actually recorded', () => {
		// list price is 60; the gateway recorded 30, so every meter halves
		const c = allocateCost(list, tokens, 30);
		expect(sumMeterValues(c)).toBeCloseTo(30);
		expect(c.input).toBeCloseTo(5);
		expect(c.output).toBeCloseTo(25);
	});

	it('reconciles exactly — the meters always sum to the recorded spend', () => {
		for (const actual of [0.000001, 1, 12.34, 99_999]) {
			expect(sumMeterValues(allocateCost(list, tokens, actual))).toBeCloseTo(actual, 9);
		}
	});

	it('falls back to a token share when spend exists with no rate card behind it', () => {
		const c = allocateCost(emptyMeterValues(), tokens, 8);
		// half the tokens are input, half output, so the spend splits evenly
		expect(c.input).toBeCloseTo(4);
		expect(c.output).toBeCloseTo(4);
		expect(sumMeterValues(c)).toBeCloseTo(8);
	});

	it('attributes nothing when there was no spend', () => {
		expect(allocateCost(list, tokens, 0)).toEqual(emptyMeterValues());
	});

	it('attributes nothing when there is neither price nor volume', () => {
		expect(allocateCost(emptyMeterValues(), emptyMeterValues(), 5)).toEqual(emptyMeterValues());
	});
});

describe('effectiveRatePerMtok', () => {
	it('recovers the rate card figure for a pure meter', () => {
		const s = sums({ outputTokens: 2_000_000 });
		const cost = meterListCosts(s, rates).output;
		expect(effectiveRatePerMtok(cost, splitMeters(s).output)).toBeCloseTo(50);
	});

	it('has no rate to report for a line with no tokens', () => {
		expect(effectiveRatePerMtok(0, 0)).toBeNull();
	});
});

describe('METER_ORDER', () => {
	it('covers every meter exactly once, so no volume can go unlisted', () => {
		expect([...METER_ORDER].sort()).toEqual(Object.keys(emptyMeterValues()).sort());
	});
});
