import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/server/api/errors';
import { parsePolicyCreate, parsePolicyPatch } from '$lib/server/api/policy-body';
import { parsePricingCreate, parsePricingPatch } from '$lib/server/api/pricing-body';

function apiError(fn: () => unknown): ApiError {
	try {
		fn();
	} catch (err) {
		if (err instanceof ApiError) return err;
		throw err;
	}
	throw new Error('expected an ApiError');
}

describe('parsePolicyCreate', () => {
	it('applies defaults for absent limits', () => {
		expect(parsePolicyCreate({ name: ' openai-only ', allowedProviders: ['openai'] })).toEqual({
			name: 'openai-only',
			allowedProviders: ['openai'],
			allowedModels: [],
			preferredProvider: null,
			rateLimitPerMinute: 0,
			dailyBudgetUsd: 0,
			monthlyBudgetUsd: 0,
			cacheTtlSeconds: null
		});
	});

	it('accepts every policy field', () => {
		expect(
			parsePolicyCreate({
				name: 'p',
				allowedModels: ['gpt-4o'],
				preferredProvider: 'azure',
				rateLimitPerMinute: 60,
				dailyBudgetUsd: '1.5',
				monthlyBudgetUsd: 20,
				cacheTtlSeconds: 0
			})
		).toMatchObject({
			allowedModels: ['gpt-4o'],
			preferredProvider: 'azure',
			rateLimitPerMinute: 60,
			dailyBudgetUsd: 1.5,
			monthlyBudgetUsd: 20,
			cacheTtlSeconds: 0
		});
	});

	it('rejects invalid values instead of coercing them to 0', () => {
		expect(apiError(() => parsePolicyCreate({})).field).toBe('name');
		expect(apiError(() => parsePolicyCreate({ name: 'p', rateLimitPerMinute: 'abc' })).field).toBe(
			'rateLimitPerMinute'
		);
		expect(apiError(() => parsePolicyCreate({ name: 'p', dailyBudgetUsd: -1 })).field).toBe(
			'dailyBudgetUsd'
		);
		expect(apiError(() => parsePolicyCreate({ name: 'p', allowedProviders: 'openai' })).field).toBe(
			'allowedProviders'
		);
	});
});

describe('parsePolicyPatch', () => {
	it('keeps only whitelisted fields that are present', () => {
		expect(
			parsePolicyPatch({
				name: 'renamed',
				rateLimitPerMinute: 10,
				cacheTtlSeconds: null,
				id: 'hijack',
				createdAt: '2000-01-01'
			})
		).toEqual({ name: 'renamed', rateLimitPerMinute: 10, cacheTtlSeconds: null });
	});

	it('rejects null for non-nullable columns', () => {
		for (const key of [
			'name',
			'allowedProviders',
			'allowedModels',
			'rateLimitPerMinute',
			'dailyBudgetUsd',
			'monthlyBudgetUsd'
		]) {
			expect(apiError(() => parsePolicyPatch({ [key]: null })).field).toBe(key);
		}
	});

	it('rejects a body without any accepted field', () => {
		expect(apiError(() => parsePolicyPatch({ id: 'x' })).message).toBe(
			'No updatable fields provided'
		);
	});
});

describe('parsePricingCreate', () => {
	it('parses required and optional rates', () => {
		expect(
			parsePricingCreate({
				model: 'gpt-4o',
				provider: 'openai',
				inputPerMtok: 2.5,
				outputPerMtok: '10',
				cacheReadPerMtok: 1.25,
				longInputPerMtok: null
			})
		).toEqual({
			model: 'gpt-4o',
			provider: 'openai',
			inputPerMtok: 2.5,
			outputPerMtok: 10,
			cacheReadPerMtok: 1.25,
			longInputPerMtok: null
		});
	});

	it('rejects missing or negative prices', () => {
		expect(apiError(() => parsePricingCreate({ inputPerMtok: 1, outputPerMtok: 1 })).field).toBe(
			'model'
		);
		expect(apiError(() => parsePricingCreate({ model: 'm', outputPerMtok: 1 })).field).toBe(
			'inputPerMtok'
		);
		expect(
			apiError(() =>
				parsePricingCreate({ model: 'm', inputPerMtok: 1, outputPerMtok: 1, cacheWritePerMtok: -1 })
			).field
		).toBe('cacheWritePerMtok');
	});
});

describe('parsePricingPatch', () => {
	it('clears nullable rates and ignores unknown fields', () => {
		expect(
			parsePricingPatch({
				provider: '',
				inputPerMtok: 3,
				longCacheReadPerMtok: null,
				isDefault: true
			})
		).toEqual({ provider: null, inputPerMtok: 3, longCacheReadPerMtok: null });
	});

	it('rejects clearing required rates and empty patches', () => {
		expect(apiError(() => parsePricingPatch({ outputPerMtok: null })).field).toBe('outputPerMtok');
		expect(apiError(() => parsePricingPatch({ model: 'x' })).message).toBe(
			'No updatable fields provided'
		);
	});
});
