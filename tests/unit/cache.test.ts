import { describe, it, expect } from 'vitest';
import { isDeterministicRequest, cacheKeyFor } from '$lib/server/cache';

describe('isDeterministicRequest', () => {
	it('always caches embeddings (deterministic by nature)', () => {
		expect(isDeterministicRequest('embeddings', { input: 'hello' })).toBe(true);
		expect(isDeterministicRequest('embeddings', {})).toBe(true);
	});

	it('caches chat/responses only when sampling is pinned', () => {
		expect(isDeterministicRequest('chat', { temperature: 0 })).toBe(true);
		expect(isDeterministicRequest('chat', { seed: 42 })).toBe(true);
		expect(isDeterministicRequest('responses', { seed: 0 })).toBe(true);
	});

	it('does not cache chat/responses at the default (varied) sampling', () => {
		expect(isDeterministicRequest('chat', {})).toBe(false);
		expect(isDeterministicRequest('chat', { temperature: 1 })).toBe(false);
		expect(isDeterministicRequest('chat', { temperature: 0.7 })).toBe(false);
	});

	it('treats seed=null as no seed', () => {
		expect(isDeterministicRequest('chat', { seed: null })).toBe(false);
	});

	it('rejects non-record bodies and unknown scopes', () => {
		expect(isDeterministicRequest('chat', null)).toBe(false);
		expect(isDeterministicRequest('chat', 'nope')).toBe(false);
		expect(isDeterministicRequest('models', { temperature: 0 })).toBe(false);
	});
});

describe('cacheKeyFor', () => {
	const body = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], temperature: 0 };

	it('is a stable sha256 hex digest', () => {
		const key = cacheKeyFor('openai', '/chat/completions', body, null);
		expect(key).toMatch(/^[0-9a-f]{64}$/);
		expect(cacheKeyFor('openai', '/chat/completions', body, null)).toBe(key);
	});

	it('is invariant to object key ordering (canonicalized)', () => {
		const reordered = { temperature: 0, messages: body.messages, model: 'gpt-4o' };
		expect(cacheKeyFor('openai', '/chat/completions', reordered, null)).toBe(
			cacheKeyFor('openai', '/chat/completions', body, null)
		);
	});

	it('ignores output-irrelevant fields (user, metadata, store)', () => {
		const noisy = { ...body, user: 'abuse-tag', metadata: { x: 1 }, store: false };
		expect(cacheKeyFor('openai', '/chat/completions', noisy, null)).toBe(
			cacheKeyFor('openai', '/chat/completions', body, null)
		);
	});

	it('still distinguishes requests by a meaningful field', () => {
		const other = { ...body, messages: [{ role: 'user', content: 'bye' }] };
		expect(cacheKeyFor('openai', '/chat/completions', other, null)).not.toBe(
			cacheKeyFor('openai', '/chat/completions', body, null)
		);
	});

	it('keys on provider and path so formats/providers never collide', () => {
		const base = cacheKeyFor('openai', '/chat/completions', body, null);
		expect(cacheKeyFor('azure', '/chat/completions', body, null)).not.toBe(base);
		expect(cacheKeyFor('openai', '/embeddings', body, null)).not.toBe(base);
	});

	it('keys on the provider secret so different upstream accounts never collide', () => {
		const base = cacheKeyFor('openai', '/chat/completions', body, null);
		expect(cacheKeyFor('openai', '/chat/completions', body, 'secret-a')).not.toBe(base);
		expect(cacheKeyFor('openai', '/chat/completions', body, 'secret-b')).not.toBe(
			cacheKeyFor('openai', '/chat/completions', body, 'secret-a')
		);
	});
});
