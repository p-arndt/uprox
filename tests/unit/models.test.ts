import { describe, it, expect } from 'vitest';
import { isEmbeddingModel } from '$lib/models';

describe('isEmbeddingModel', () => {
	it('matches OpenAI text-embedding models', () => {
		expect(isEmbeddingModel('text-embedding-3-small')).toBe(true);
		expect(isEmbeddingModel('text-embedding-3-large')).toBe(true);
		expect(isEmbeddingModel('text-embedding-ada-002')).toBe(true);
	});

	it('matches case-insensitively and any model carrying "embedding"', () => {
		expect(isEmbeddingModel('My-Embedding-Deployment')).toBe(true);
	});

	it('does not match chat/completion models', () => {
		expect(isEmbeddingModel('gpt-5.5')).toBe(false);
		expect(isEmbeddingModel('claude-opus-4-7')).toBe(false);
	});

	it('handles null/undefined', () => {
		expect(isEmbeddingModel(null)).toBe(false);
		expect(isEmbeddingModel(undefined)).toBe(false);
		expect(isEmbeddingModel('')).toBe(false);
	});
});
