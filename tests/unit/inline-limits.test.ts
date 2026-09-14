import { describe, expect, it } from 'vitest';
import { emptyInlineLimits, inlineLimitsFromRow } from '$lib/components/inline-limits';

describe('inlineLimitsFromRow', () => {
	it('maps null columns to inherit', () => {
		expect(
			inlineLimitsFromRow({
				allowedProviders: null,
				allowedModels: null,
				preferredProvider: null,
				rateLimitPerMinute: null,
				dailyBudgetUsd: null,
				monthlyBudgetUsd: null,
				cacheTtlSeconds: null,
				tracingEnabled: null
			})
		).toEqual(emptyInlineLimits());
	});

	it('stringifies set values and normalizes numeric strings', () => {
		const providers = ['openai'];
		const values = inlineLimitsFromRow({
			allowedProviders: providers,
			allowedModels: ['gpt-4o', 'o3'],
			preferredProvider: 'azure',
			rateLimitPerMinute: 0,
			dailyBudgetUsd: '5.00',
			monthlyBudgetUsd: 20,
			cacheTtlSeconds: 300,
			tracingEnabled: false
		});
		expect(values).toEqual({
			allowedProviders: ['openai'],
			allowedModels: 'gpt-4o, o3',
			preferredProvider: 'azure',
			rateLimitPerMinute: '0',
			dailyBudgetUsd: '5',
			monthlyBudgetUsd: '20',
			cacheTtlSeconds: '300',
			tracingEnabled: 'false'
		});
		// the form edits its own copy
		expect(values.allowedProviders).not.toBe(providers);
	});
});
