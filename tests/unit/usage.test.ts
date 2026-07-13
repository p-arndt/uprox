import { describe, it, expect } from 'vitest';
import { normalizeUsage } from '../../src/lib/server/usage';

describe('normalizeUsage — OpenAI chat shape', () => {
	it('keeps cache reads inside prompt_tokens (they are already counted there)', () => {
		expect(
			normalizeUsage({
				prompt_tokens: 2006,
				completion_tokens: 300,
				prompt_tokens_details: { cached_tokens: 1920, cache_write_tokens: 0 }
			})
		).toEqual({ input: 2006, output: 300, cacheRead: 1920, cacheWrite: 0 });
	});

	it('reads GPT-5.6 cache writes from prompt_tokens_details', () => {
		// The field the cost calc needs to bill writes at 1.25× instead of 1×.
		expect(
			normalizeUsage({
				prompt_tokens: 10_000,
				completion_tokens: 500,
				prompt_tokens_details: { cached_tokens: 6_000, cache_write_tokens: 3_000 }
			})
		).toEqual({ input: 10_000, output: 500, cacheRead: 6_000, cacheWrite: 3_000 });
	});

	it('treats a write-only details object as the OpenAI shape (no double-count)', () => {
		// A first cached call writes without reading: cached_tokens may be absent.
		// input must stay 10k — folding the writes in would inflate it to 13k.
		expect(
			normalizeUsage({
				prompt_tokens: 10_000,
				completion_tokens: 100,
				prompt_tokens_details: { cache_write_tokens: 3_000 }
			})
		).toEqual({ input: 10_000, output: 100, cacheRead: null, cacheWrite: 3_000 });
	});

	it('handles a plain response with no cache details', () => {
		expect(normalizeUsage({ prompt_tokens: 120, completion_tokens: 40 })).toEqual({
			input: 120,
			output: 40,
			cacheRead: null,
			cacheWrite: null
		});
	});
});

describe('normalizeUsage — OpenAI Responses shape', () => {
	it('reads input_tokens_details for reads and writes', () => {
		expect(
			normalizeUsage({
				input_tokens: 8_000,
				output_tokens: 250,
				input_tokens_details: { cached_tokens: 4_000, cache_write_tokens: 2_000 }
			})
		).toEqual({ input: 8_000, output: 250, cacheRead: 4_000, cacheWrite: 2_000 });
	});
});

describe('normalizeUsage — Anthropic shape', () => {
	it('folds top-level cache counts into input (input_tokens excludes them)', () => {
		expect(
			normalizeUsage({
				input_tokens: 100,
				output_tokens: 50,
				cache_read_input_tokens: 5_000,
				cache_creation_input_tokens: 2_000
			})
		).toEqual({ input: 7_100, output: 50, cacheRead: 5_000, cacheWrite: 2_000 });
	});
});

describe('normalizeUsage — absent usage', () => {
	it('returns null for a non-object or an empty usage object', () => {
		expect(normalizeUsage(undefined)).toBeNull();
		expect(normalizeUsage(null)).toBeNull();
		expect(normalizeUsage('nope')).toBeNull();
		expect(normalizeUsage({})).toBeNull();
	});
});
