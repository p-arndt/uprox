import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/server/api/errors';
import { parseInlineConfigBody } from '$lib/server/api/inline-config-body';
import { parseServiceCreate, parseServicePatch } from '$lib/server/api/service-body';
import { parseTokenCreate, parseTokenPatch, tokenResponse } from '$lib/server/api/token-body';
import { parseProviderCreate } from '$lib/server/api/provider-body';
import { PROVIDERS } from '$lib/server/providers';

const UUID = '3f0c1c52-8a4e-4a3b-9d0e-6a1b2c3d4e5f';

function apiError(fn: () => unknown): ApiError {
	try {
		fn();
	} catch (err) {
		if (err instanceof ApiError) return err;
		throw err;
	}
	throw new Error('expected an ApiError');
}

describe('parseInlineConfigBody', () => {
	it('returns only present fields, null meaning inherit', () => {
		expect(
			parseInlineConfigBody({
				allowedProviders: ['openai'],
				rateLimitPerMinute: 30,
				dailyBudgetUsd: null,
				allowedModels: ['ignored-here']
			})
		).toEqual({
			allowedProviders: ['openai'],
			rateLimitPerMinute: 30,
			dailyBudgetUsd: null
		});
		expect(parseInlineConfigBody({})).toEqual({});
	});

	it('rejects invalid values instead of dropping them', () => {
		expect(apiError(() => parseInlineConfigBody({ rateLimitPerMinute: -5 })).field).toBe(
			'rateLimitPerMinute'
		);
		expect(apiError(() => parseInlineConfigBody({ cacheTtlSeconds: 1.5 })).field).toBe(
			'cacheTtlSeconds'
		);
	});
});

describe('parseServiceCreate', () => {
	it('matches the provision example payload', () => {
		expect(parseServiceCreate({ name: 'demo-agent', type: 'agent', policyId: UUID })).toEqual({
			name: 'demo-agent',
			type: 'agent',
			description: undefined,
			policyId: UUID,
			providerSecretId: null
		});
	});

	it('accepts inline overrides and a model allowlist', () => {
		expect(
			parseServiceCreate({ name: 's', allowedModels: ['gpt-4o'], monthlyBudgetUsd: 50 })
		).toMatchObject({ allowedModels: ['gpt-4o'], monthlyBudgetUsd: 50 });
	});

	it('rejects a missing name and malformed ids', () => {
		expect(apiError(() => parseServiceCreate({})).field).toBe('name');
		expect(apiError(() => parseServiceCreate({ name: 's', policyId: 'nope' })).field).toBe(
			'policyId'
		);
	});
});

describe('parseServicePatch', () => {
	it('keeps present fields and clears with null', () => {
		expect(
			parseServicePatch({ name: ' renamed ', description: '', policyId: null, deletedAt: 'x' })
		).toEqual({ name: 'renamed', description: null, policyId: null });
	});

	it('rejects blank names and empty patches', () => {
		expect(apiError(() => parseServicePatch({ name: '' })).field).toBe('name');
		expect(apiError(() => parseServicePatch({})).status).toBe(400);
	});
});

describe('parseTokenCreate', () => {
	it('matches the provision example payload', () => {
		expect(parseTokenCreate({ serviceId: UUID, name: 'demo' })).toEqual({
			serviceId: UUID,
			name: 'demo',
			scopes: [],
			allowedModels: [],
			policyId: null,
			expiresAt: null
		});
	});

	it('defaults to the Default service and parses expiry', () => {
		const input = parseTokenCreate({ name: 't', serviceId: '', expiresAt: '2027-01-01T00:00:00Z' });
		expect(input.serviceId).toBeUndefined();
		expect(input.expiresAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
	});

	it('rejects invalid fields', () => {
		expect(apiError(() => parseTokenCreate({})).field).toBe('name');
		expect(apiError(() => parseTokenCreate({ name: 't', serviceId: 'x' })).field).toBe('serviceId');
		expect(apiError(() => parseTokenCreate({ name: 't', expiresAt: 'later' })).field).toBe(
			'expiresAt'
		);
		expect(apiError(() => parseTokenCreate({ name: 't', scopes: [1] })).field).toBe('scopes');
	});
});

describe('parseTokenPatch', () => {
	it('keeps whitelisted fields only', () => {
		expect(
			parseTokenPatch({ scopes: ['chat'], policyId: null, hashedToken: 'x', rateLimitPerMinute: 5 })
		).toEqual({ scopes: ['chat'], policyId: null, rateLimitPerMinute: 5 });
	});

	it('rejects null for non-null arrays and empty patches', () => {
		expect(apiError(() => parseTokenPatch({ allowedModels: null })).field).toBe('allowedModels');
		expect(apiError(() => parseTokenPatch({ serviceId: UUID })).message).toBe(
			'No updatable fields provided'
		);
	});

	it('sets a future expiry or clears it with null', () => {
		const now = Date.parse('2026-01-01T00:00:00Z');
		expect(parseTokenPatch({ expiresAt: '2026-06-01T00:00:00Z' }, now)).toEqual({
			expiresAt: new Date('2026-06-01T00:00:00Z')
		});
		expect(parseTokenPatch({ expiresAt: null }, now)).toEqual({ expiresAt: null });
	});

	it('rejects an expiry that is not in the future', () => {
		const now = Date.parse('2026-01-01T00:00:00Z');
		expect(apiError(() => parseTokenPatch({ expiresAt: '2025-12-31T00:00:00Z' }, now)).field).toBe(
			'expiresAt'
		);
		expect(apiError(() => parseTokenPatch({ expiresAt: now }, now)).field).toBe('expiresAt');
	});

	it('only lets recopyable be switched off', () => {
		expect(parseTokenPatch({ recopyable: false })).toEqual({ recopyable: false });
		expect(apiError(() => parseTokenPatch({ recopyable: true })).field).toBe('recopyable');
		expect(apiError(() => parseTokenPatch({ recopyable: null })).field).toBe('recopyable');
	});
});

describe('tokenResponse', () => {
	it('strips secret-derived columns and reports recopyability', () => {
		expect(tokenResponse({ id: '1', hashedToken: 'h', encryptedToken: null })).toEqual({
			id: '1',
			recopyable: false
		});
		expect(tokenResponse({ id: '1', hashedToken: 'h', encryptedToken: 'e' }).recopyable).toBe(true);
	});
});

describe('parseProviderCreate', () => {
	const endpointProvider = Object.keys(PROVIDERS).find((id) => PROVIDERS[id]?.requiresEndpoint)!;

	it('parses a provider secret', () => {
		expect(parseProviderCreate({ provider: 'openai', secret: 'sk-1', priority: 2 })).toEqual({
			provider: 'openai',
			secret: 'sk-1',
			label: undefined,
			baseUrl: undefined,
			priority: 2
		});
	});

	it('rejects unknown providers, missing secrets and missing endpoints', () => {
		expect(apiError(() => parseProviderCreate({ provider: 'nope', secret: 's' })).message).toBe(
			'unknown provider "nope"'
		);
		expect(apiError(() => parseProviderCreate({ provider: 'openai' })).field).toBe('secret');
		expect(
			apiError(() => parseProviderCreate({ provider: endpointProvider, secret: 's', baseUrl: ' ' }))
				.field
		).toBe('baseUrl');
		expect(
			parseProviderCreate({ provider: endpointProvider, secret: 's', baseUrl: ' https://x ' })
				.baseUrl
		).toBe('https://x');
	});
});

describe('model allowlist patterns on services and tokens', () => {
	it('rejects a * that is not at the end, naming the field', () => {
		const bad = { name: 'x', allowedModels: ['gpt-*-mini'] };
		for (const parse of [
			parseServiceCreate,
			parseServicePatch,
			parseTokenCreate,
			parseTokenPatch
		]) {
			const err = apiError(() => parse(bad));
			expect(err.status).toBe(400);
			expect(err.field).toBe('allowedModels');
		}
	});

	it('accepts exact ids and trailing prefix globs', () => {
		const ok = { name: 'x', allowedModels: ['gpt-4o*', 'claude-sonnet-4-6'] };
		expect(parseServiceCreate(ok).allowedModels).toEqual(ok.allowedModels);
		expect(parseTokenCreate(ok).allowedModels).toEqual(ok.allowedModels);
	});
});
