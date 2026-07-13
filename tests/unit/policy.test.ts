import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '$lib/server/policy';
import type { ResolvedToken } from '$lib/server/tokens';
import type { EffectiveConfig } from '$lib/server/effective-config';

/** Minimal effective config; the policy engine only reads the allowlists + scope. */
function eff(over: Partial<EffectiveConfig> = {}): EffectiveConfig {
	return {
		providerLists: [],
		modelLists: [],
		preferredProvider: null,
		rateLimitPerMinute: 0,
		cacheTtlSeconds: 0,
		tracingEnabled: false,
		tokenBudget: { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 },
		serviceBudget: { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 },
		instanceBudget: { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 },
		...over
	};
}

/** Minimal ResolvedToken builder; only the fields the policy engine reads matter. */
function token(over: Partial<ResolvedToken> = {}): ResolvedToken {
	return {
		tokenId: 't1',
		serviceId: 'svc1',
		serviceName: 'svc',
		scopes: [],
		providerSecretId: null,
		effective: eff(),
		...over
	};
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

describe('no restrictions', () => {
	it('allows once scopes pass and no allowlists apply', () => {
		expect(evaluatePolicy(token({ scopes: ['chat'] }), chat)).toEqual({ allow: true });
	});
});

describe('provider allowlist', () => {
	it('allows when the provider is listed', () => {
		const t = token({ effective: eff({ providerLists: [['openai']] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});

	it('denies when the provider is not listed', () => {
		const t = token({ effective: eff({ providerLists: [['anthropic']] }) });
		const res = evaluatePolicy(t, chat);
		expect(res.allow).toBe(false);
		expect(res).toMatchObject({ reason: expect.stringContaining('openai') });
	});

	it('allows any provider when no list applies', () => {
		const t = token({ effective: eff({ providerLists: [] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});

	it('intersects multiple provider lists (must satisfy all)', () => {
		// one layer allows openai+azure, another only azure → openai is denied
		const t = token({ effective: eff({ providerLists: [['openai', 'azure'], ['azure']] }) });
		expect(evaluatePolicy(t, chat).allow).toBe(false);
		expect(evaluatePolicy(t, { ...chat, provider: 'azure' })).toEqual({ allow: true });
	});
});

describe('model allowlist', () => {
	it('allows an exact model match', () => {
		const t = token({ effective: eff({ modelLists: [['gpt-4o']] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});

	it('denies a model that is not listed', () => {
		const t = token({ effective: eff({ modelLists: [['gpt-4o-mini']] }) });
		const res = evaluatePolicy(t, chat);
		expect(res.allow).toBe(false);
		expect(res).toMatchObject({ reason: expect.stringContaining('gpt-4o') });
	});

	it('supports trailing "*" prefix globs', () => {
		const t = token({ effective: eff({ modelLists: [['gpt-4o*']] }) });
		expect(evaluatePolicy(t, { ...chat, model: 'gpt-4o-mini' })).toEqual({ allow: true });
		expect(evaluatePolicy(t, { ...chat, model: 'claude-opus-4-7' }).allow).toBe(false);
	});

	it('matches if any pattern in a single list matches', () => {
		const t = token({ effective: eff({ modelLists: [['claude-*', 'gpt-4o']] }) });
		expect(evaluatePolicy(t, chat)).toEqual({ allow: true });
	});

	it('matches case-insensitively, consistent with routing', () => {
		const glob = token({ effective: eff({ modelLists: [['gpt-4o*']] }) });
		expect(evaluatePolicy(glob, { ...chat, model: 'GPT-4o' })).toEqual({ allow: true });

		const exact = token({ effective: eff({ modelLists: [['gpt-4o']] }) });
		expect(evaluatePolicy(exact, { ...chat, model: 'GPT-4O' })).toEqual({ allow: true });

		expect(evaluatePolicy(exact, { ...chat, model: 'GPT-4o-mini' }).allow).toBe(false);
	});
});

describe('model intersection across layers', () => {
	it('narrows: a model must satisfy every list (e.g. token over preset)', () => {
		// preset allows the gpt-4o family, a narrower layer restricts to mini only
		const t = token({ effective: eff({ modelLists: [['gpt-4o-mini'], ['gpt-4o*']] }) });
		expect(evaluatePolicy(t, { ...chat, model: 'gpt-4o-mini' })).toEqual({ allow: true });
		// gpt-4o passes the wide list but fails the narrow one
		expect(evaluatePolicy(t, { ...chat, model: 'gpt-4o' }).allow).toBe(false);
	});

	it('cannot widen: an extra permissive layer still loses to a restrictive one', () => {
		const t = token({ effective: eff({ modelLists: [['claude-opus-4-7'], ['gpt-4o']] }) });
		// claude passes the first list but the second forbids it
		expect(evaluatePolicy(t, { ...chat, model: 'claude-opus-4-7' }).allow).toBe(false);
	});

	it('skips model rules for an empty model (the /v1/models provider probe)', () => {
		const t = token({ effective: eff({ modelLists: [['gpt-4o']] }), scopes: ['models'] });
		expect(evaluatePolicy(t, { provider: 'openai', model: '', scope: 'models' })).toEqual({
			allow: true
		});
	});
});

describe('files scope (regression: Files API enforcement)', () => {
	// proxyRawUpstream gates the Files API with evaluatePolicy(..., scope: 'files').
	// These lock in that a token must be permitted for 'files' the same way as any
	// other scope, so the Files proxy can't be reached by an out-of-scope token.
	const files = { provider: 'openai', model: '', scope: 'files' };

	it('allows files for a token with no explicit scopes (empty = all)', () => {
		expect(evaluatePolicy(token({ scopes: [] }), files)).toEqual({ allow: true });
	});

	it('denies files for a token explicitly scoped to something else', () => {
		const res = evaluatePolicy(token({ scopes: ['chat', 'embeddings'] }), files);
		expect(res.allow).toBe(false);
		expect(res).toMatchObject({ reason: expect.stringContaining('files') });
	});

	it('allows files when the token explicitly lists the files scope', () => {
		expect(evaluatePolicy(token({ scopes: ['files'] }), files)).toEqual({ allow: true });
	});

	it("denies files when the policy's provider allowlist excludes the routed provider", () => {
		const t = token({ scopes: ['files'], effective: eff({ providerLists: [['azure']] }) });
		const res = evaluatePolicy(t, files);
		expect(res.allow).toBe(false);
		expect(res).toMatchObject({ reason: expect.stringContaining('openai') });
	});
});

describe('rule ordering', () => {
	it('checks scope before provider/model rules', () => {
		const t = token({
			scopes: ['embeddings'],
			effective: eff({ providerLists: [['openai']], modelLists: [['gpt-4o']] })
		});
		expect(evaluatePolicy(t, chat)).toMatchObject({ reason: expect.stringContaining('chat') });
	});
});
