import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '$lib/server/policy';
import type { ResolvedToken } from '$lib/server/tokens';

/** Minimal ResolvedToken builder; only the fields the policy engine reads matter. */
function token(over: Partial<ResolvedToken> = {}): ResolvedToken {
	return {
		tokenId: 't1',
		serviceId: 'svc1',
		serviceName: 'svc',
		scopes: [],
		policy: null,
		defaultCacheTtlSeconds: 0,
		...over
	};
}

/** Minimal policy row with empty allowlists (= allow all). */
function policy(over: Record<string, unknown> = {}) {
	return {
		allowedProviders: [] as string[],
		allowedModels: [] as string[],
		...over
	} as unknown as NonNullable<ResolvedToken['policy']>;
}

const chat = { provider: 'openai', model: 'gpt-4o', scope: 'chat' };

describe('scope check', () => {
	it('allows any scope when the token has no scopes (empty = all)', () => {
		expect(evaluatePolicy(token({ scopes: [] }), chat)).toEqual({ allow: true });
	});

	it('allows a scope the token is granted', () => {
		expect(evaluatePolicy(token({ scopes: ['chat', 'models'] }), chat)).toEqual({ allow: true });
	});

	it('denies a scope the token lacks', () => {
		const res = evaluatePolicy(token({ scopes: ['embeddings'] }), chat);
		expect(res.allow).toBe(false);
		expect(res).toMatchObject({ reason: expect.stringContaining('chat') });
	});
});

describe('no policy attached', () => {
	it('allows once scopes pass', () => {
		expect(evaluatePolicy(token({ scopes: ['chat'], policy: null }), chat)).toEqual({
			allow: true
		});
	});
});

describe('provider allowlist', () => {
	it('allows when the provider is listed', () => {
		const t = token({ policy: policy({ allowedProviders: ['openai'] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});

	it('denies when the provider is not listed', () => {
		const t = token({ policy: policy({ allowedProviders: ['anthropic'] }) });
		const res = evaluatePolicy(t, chat);
		expect(res.allow).toBe(false);
		expect(res).toMatchObject({ reason: expect.stringContaining('openai') });
	});

	it('allows any provider when the list is empty', () => {
		const t = token({ policy: policy({ allowedProviders: [] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});
});

describe('model allowlist', () => {
	it('allows an exact model match', () => {
		const t = token({ policy: policy({ allowedModels: ['gpt-4o'] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});

	it('denies a model that is not listed', () => {
		const t = token({ policy: policy({ allowedModels: ['gpt-4o-mini'] }) });
		const res = evaluatePolicy(t, chat);
		expect(res.allow).toBe(false);
		expect(res).toMatchObject({ reason: expect.stringContaining('gpt-4o') });
	});

	it('supports trailing "*" prefix globs', () => {
		const t = token({ policy: policy({ allowedModels: ['gpt-4o*'] }) });
		expect(evaluatePolicy(t, { ...chat, model: 'gpt-4o-mini' })).toEqual({ allow: true });
		expect(evaluatePolicy(t, { ...chat, model: 'claude-opus-4-7' }).allow).toBe(false);
	});

	it('matches if any pattern in the list matches', () => {
		const t = token({ policy: policy({ allowedModels: ['claude-*', 'gpt-4o'] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});

	it('matches case-insensitively, consistent with routing', () => {
		// glob branch: "gpt-4o*" matches a request for "GPT-4o"
		const glob = token({ policy: policy({ allowedModels: ['gpt-4o*'] }) });
		expect(evaluatePolicy(glob, { ...chat, model: 'GPT-4o' })).toEqual({ allow: true });

		// exact branch: "gpt-4o" matches a request for "GPT-4O"
		const exact = token({ policy: policy({ allowedModels: ['gpt-4o'] }) });
		expect(evaluatePolicy(exact, { ...chat, model: 'GPT-4O' })).toEqual({ allow: true });

		// a non-matching model is still denied
		const res = evaluatePolicy(exact, { ...chat, model: 'GPT-4o-mini' });
		expect(res.allow).toBe(false);
	});
});

describe('rule ordering', () => {
	it('checks scope before policy provider/model rules', () => {
		const t = token({
			scopes: ['embeddings'],
			policy: policy({ allowedProviders: ['openai'], allowedModels: ['gpt-4o'] })
		});
		// scope fails first even though provider+model would pass
		expect(evaluatePolicy(t, chat)).toMatchObject({ reason: expect.stringContaining('chat') });
	});
});
