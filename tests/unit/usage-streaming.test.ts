import { describe, expect, it, vi } from 'vitest';
import { streamed } from '$lib/server/usage-analysis';
import { headlineCells } from '$lib/features/usage/headline';

describe('streamed', () => {
	it('wraps a resolved value', async () => {
		await expect(streamed(Promise.resolve([1, 2]), [], 'rows')).resolves.toEqual({
			value: [1, 2],
			failed: false
		});
	});

	it('never rejects: a failure resolves to the empty shape and is logged', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(streamed(Promise.reject(new Error('boom')), [], 'rows')).resolves.toEqual({
			value: [],
			failed: true
		});
		expect(log).toHaveBeenCalledOnce();
		log.mockRestore();
	});
});

describe('headlineCells without a previous window', () => {
	const totals = {
		requests: 10,
		costUsd: 20,
		errors: 0,
		denied: 0,
		latencyP50: null,
		latencyP95: null,
		inputTokens: 5,
		outputTokens: 5,
		savedInputTokens: 0,
		providerCachedTokens: 0,
		embeddingInputTokens: 0
	};

	it('marks the comparable cells but leaves their delta absent while it streams', () => {
		const cells = headlineCells(totals, null, []);
		expect(cells.filter((c) => c.compares).map((c) => c.label)).toEqual([
			'Spend',
			'Requests',
			'Tokens'
		]);
		expect(cells.every((c) => c.delta === undefined)).toBe(true);
	});

	it('fills the deltas once the previous window is known', () => {
		const cells = headlineCells(totals, { ...totals, costUsd: 10, requests: 0 }, []);
		expect(cells[0].delta).toBe(100);
		// no baseline to divide by
		expect(cells[1].delta).toBeNull();
	});
});
