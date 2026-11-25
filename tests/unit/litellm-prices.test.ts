import { describe, it, expect } from 'vitest';
import { parseLiteLLMPrices, diffAgainst } from '$lib/server/litellm-prices';
import fixture from '../fixtures/litellm-prices.sample.json';

const prices = parseLiteLLMPrices(fixture);

describe('parseLiteLLMPrices — filtering', () => {
	it('maps exactly the token-billed openai/anthropic/gemini entries', () => {
		expect(Object.keys(prices).sort()).toEqual(
			[
				'claude-haiku-5-5',
				'claude-sonnet-5-5',
				'gemini-2.5-pro',
				'gemini-4-carbon',
				'gemini-embedding-001',
				'gemini-pro-latest',
				'gpt-4o',
				'gpt-5.5',
				'gpt-5.5-pro',
				'gpt-6-astra-law',
				'gpt-6.2-astra',
				'gpt-image-1',
				'gpt-image-1.5',
				'text-embedding-3-small'
			].sort()
		);
	});

	it('drops sample_spec, other providers, and unsupported modes', () => {
		expect(prices).not.toHaveProperty('sample_spec');
		// vertex / azure entries
		expect(Object.keys(prices).some((k) => k.includes('sonnet-4-5'))).toBe(false);
		// audio_transcription mode; gemini "decisions" mode
		expect(prices).not.toHaveProperty('gpt-4o-transcribe-diarize');
		expect(prices).not.toHaveProperty('gemini-decision-1');
	});

	it('drops fine-tunes, per-size image SKUs and keys outside the routing prefixes', () => {
		const keys = Object.keys(prices);
		expect(keys.some((k) => k.includes(':') || k.includes('/'))).toBe(false);
		expect(prices).not.toHaveProperty('container'); // openai/container
		expect(prices).not.toHaveProperty('computer-use-preview'); // no openai prefix
	});

	it('drops zero-cost and non-per-token entries', () => {
		expect(prices).not.toHaveProperty('gemma-3-27b-it'); // free tier, 0 input
		expect(prices).not.toHaveProperty('imagen-3.0-generate-001'); // per-image only
	});
});

describe('parseLiteLLMPrices — mapping', () => {
	it('converts per-token to per-1M and strips the gemini/ prefix', () => {
		expect(prices['gemini-4-carbon']).toEqual({ in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2 });
		expect(prices['gpt-4o']).toMatchObject({ in: 2.5, out: 10, cacheRead: 1.25 });
	});

	it('openai: missing cache rates bill as plain input', () => {
		// gpt-4o has a read rate but no write rate → write = in
		expect(prices['gpt-4o']?.cacheWrite).toBe(2.5);
		// the pro tier lists neither → both = in, on both cards
		expect(prices['gpt-5.5-pro']).toEqual({
			in: 30,
			out: 180,
			cacheRead: 30,
			cacheWrite: 30,
			longIn: 60,
			longOut: 270,
			longCacheRead: 60,
			longCacheWrite: 60,
			longMinPromptTokens: 272_001
		});
	});

	it('anthropic: uses listed cache rates and leaves missing ones unset', () => {
		expect(prices['claude-sonnet-5-5']).toEqual({
			in: 2,
			out: 10,
			cacheRead: 0.1,
			cacheWrite: 2.5
		});
		const synthetic = parseLiteLLMPrices({
			'claude-x-1': {
				litellm_provider: 'anthropic',
				mode: 'chat',
				input_cost_per_token: 1e-6,
				output_cost_per_token: 5e-6,
				input_cost_per_token_above_200k_tokens: 2e-6
			}
		});
		expect(synthetic['claude-x-1']).toEqual({
			in: 1,
			out: 5,
			longIn: 2,
			longOut: 5,
			longMinPromptTokens: 200_001
		});
	});

	it('embeddings: out 0, no cache rates', () => {
		expect(prices['text-embedding-3-small']).toEqual({ in: 0.02, out: 0 });
		expect(prices['gemini-embedding-001']).toEqual({ in: 0.15, out: 0 });
	});

	it('image generation: out is the image-output token rate', () => {
		expect(prices['gpt-image-1']).toMatchObject({ in: 5, out: 40, cacheRead: 1.25, cacheWrite: 5 });
		// has both output fields; the image-token one (32) wins over text (10)
		expect(prices['gpt-image-1.5']?.out).toBe(32);
	});
});

describe('parseLiteLLMPrices — long-context card', () => {
	it('maps the 272k card with an inclusive threshold', () => {
		expect(prices['gpt-6.2-astra']).toEqual({
			in: 8,
			out: 40,
			cacheRead: 0.4,
			cacheWrite: 10,
			longIn: 16,
			longOut: 60,
			longCacheRead: 0.8,
			longCacheWrite: 20, // not the _above_12hr_above_272k_tokens rate
			longMinPromptTokens: 272_001
		});
		// no long write rate listed → long input rate
		expect(prices['gpt-6-astra-law']).toMatchObject({ longIn: 20, longCacheWrite: 20 });
	});

	it('maps other thresholds (gemini 200k, anthropic 100k)', () => {
		expect(prices['gemini-2.5-pro']).toEqual({
			in: 1.25,
			out: 10,
			cacheRead: 0.125,
			cacheWrite: 1.25,
			longIn: 2.5,
			longOut: 15,
			longCacheRead: 0.25,
			longCacheWrite: 2.5,
			longMinPromptTokens: 200_001
		});
		expect(prices['claude-haiku-5-5']).toEqual({
			in: 0.1,
			out: 0.5,
			cacheRead: 0.01,
			cacheWrite: 0.125,
			longIn: 0.5,
			longOut: 2.5,
			longCacheRead: 0.05,
			longCacheWrite: 0.625,
			longMinPromptTokens: 100_001
		});
	});

	it('uses the lowest threshold when several exist', () => {
		const p = parseLiteLLMPrices({
			'gpt-x': {
				litellm_provider: 'openai',
				mode: 'chat',
				input_cost_per_token: 1e-6,
				output_cost_per_token: 2e-6,
				input_cost_per_token_above_272k_tokens: 4e-6,
				input_cost_per_token_above_128k_tokens: 3e-6,
				output_cost_per_token_above_128k_tokens: 5e-6
			}
		});
		expect(p['gpt-x']).toMatchObject({ longIn: 3, longOut: 5, longMinPromptTokens: 128_001 });
	});
});

describe('parseLiteLLMPrices — key collisions', () => {
	it('prefers the un-prefixed raw key regardless of order', () => {
		// fixture: gemini-pro-latest and gemini/gemini-pro-latest (identical prices)
		expect(prices['gemini-pro-latest']).toMatchObject({ in: 2, out: 12 });
		const entry = (inCost: number) => ({
			litellm_provider: 'gemini',
			mode: 'chat',
			input_cost_per_token: inCost,
			output_cost_per_token: 1e-6
		});
		const a = parseLiteLLMPrices({ 'gemini/gemini-x': entry(2e-6), 'gemini-x': entry(1e-6) });
		const b = parseLiteLLMPrices({ 'gemini-x': entry(1e-6), 'gemini/gemini-x': entry(2e-6) });
		expect(a['gemini-x']?.in).toBe(1);
		expect(b['gemini-x']?.in).toBe(1);
		// an invalid un-prefixed twin doesn't shadow a valid prefixed one
		const c = parseLiteLLMPrices({ 'gemini-x': entry(0), 'gemini/gemini-x': entry(2e-6) });
		expect(c['gemini-x']?.in).toBe(2);
	});

	it('lower-cases keys', () => {
		const p = parseLiteLLMPrices({
			'GPT-Y': {
				litellm_provider: 'openai',
				mode: 'chat',
				input_cost_per_token: 1e-6,
				output_cost_per_token: 1e-6
			}
		});
		expect(Object.keys(p)).toEqual(['gpt-y']);
	});
});

describe('parseLiteLLMPrices — garbage input', () => {
	it('returns {} for non-objects', () => {
		for (const v of [null, undefined, 42, 'x', [], [1, 2], true]) {
			expect(parseLiteLLMPrices(v)).toEqual({});
		}
	});

	it('skips malformed entries without throwing', () => {
		const p = parseLiteLLMPrices({
			'gpt-a': null,
			'gpt-b': 'nope',
			'gpt-c': { litellm_provider: 'openai' },
			'gpt-d': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: '1e-6' },
			'gpt-e': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: Infinity },
			'gpt-f': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: -1 },
			'gpt-g': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 1e-6 }, // no out
			'gpt-h': { litellm_provider: 42, mode: 'chat', input_cost_per_token: 1e-6 },
			'gpt-ok': {
				litellm_provider: 'openai',
				mode: 'chat',
				input_cost_per_token: 1e-6,
				output_cost_per_token: 2e-6,
				cache_read_input_token_cost: 'cheap'
			}
		});
		expect(p).toEqual({ 'gpt-ok': { in: 1, out: 2, cacheRead: 1, cacheWrite: 1 } });
	});
});

describe('diffAgainst', () => {
	it('lists differing fields on overlapping keys and missing base keys', () => {
		const base = {
			'gpt-4o': { in: 2.5, out: 10, cacheRead: 1.25, cacheWrite: 2.5 },
			'gpt-6.2-astra': { in: 8, out: 40, cacheRead: 0.4, cacheWrite: 10 },
			'gpt-nope': { in: 1, out: 1 }
		};
		const { diffs, missing } = diffAgainst(base, prices);
		expect(missing).toEqual(['gpt-nope']);
		expect(diffs.filter((d) => d.model === 'gpt-4o')).toEqual([]);
		expect(diffs).toContainEqual({
			model: 'gpt-6.2-astra',
			field: 'longIn',
			base: undefined,
			fetched: 16
		});
		expect(diffs).toContainEqual({
			model: 'gpt-6.2-astra',
			field: 'longMinPromptTokens',
			base: undefined,
			fetched: 272_001
		});
	});
});
