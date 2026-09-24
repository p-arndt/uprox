import { describe, expect, it } from 'vitest';
import {
	budgetText,
	cacheText,
	deleteDescription,
	editDescription,
	rateText,
	usageText
} from '../../src/routes/app/policies/policy-display';
import {
	parsePolicyForm,
	unknownModelsWarning
} from '../../src/routes/app/policies/policy-form.server';

function form(entries: [string, string][]): FormData {
	const fd = new FormData();
	for (const [k, v] of entries) fd.append(k, v);
	return fd;
}

describe('preset display text', () => {
	it('summarizes usage', () => {
		expect(usageText({ services: 3, tokens: 12 })).toBe('Used by 3 services · 12 tokens');
		expect(usageText({ services: 1, tokens: 1 })).toBe('Used by 1 service · 1 token');
		expect(usageText({ services: 0, tokens: 0 })).toBe('Not used yet');
	});

	it('formats rate, budget and cache consistently', () => {
		expect(rateText(0)).toBe('Rate: unlimited');
		expect(rateText(60)).toBe('Rate: 60/min per token');
		expect(budgetText('0', 0)).toBe('Budget: unlimited');
		expect(budgetText(5, '50')).toBe('Budget: $5/day · $50/mo');
		expect(cacheText(null)).toBe('Cache: instance default');
		expect(cacheText(0)).toBe('Cache: off');
		expect(cacheText(60)).toBe('Cache: 60 s');
	});

	it('states who an edit reaches and what a delete does', () => {
		expect(editDescription({ services: 2, tokens: 1 })).toContain('2 services and 1 token');
		expect(editDescription({ services: 0, tokens: 0 })).toContain('Not attached');
		const del = deleteDescription({ services: 2, tokens: 5 });
		expect(del).toContain('2 services and 5 tokens');
		expect(del).toContain('fall back to their own overrides and the instance defaults');
		expect(deleteDescription({ services: 0, tokens: 0 })).toContain('No service or token');
	});
});

describe('parsePolicyForm', () => {
	const known = ['gpt-4o', 'claude-sonnet-4-6'];

	it('requires a name', () => {
		expect(parsePolicyForm(form([['name', '  ']]), known)).toEqual({
			ok: false,
			message: 'Name is required'
		});
	});

	it('stores blank rate and budgets as 0 but keeps a blank cache as the instance default', () => {
		const parsed = parsePolicyForm(
			form([
				['name', ' Std '],
				['rateLimitPerMinute', ''],
				['dailyBudgetUsd', ''],
				['monthlyBudgetUsd', ''],
				['cacheTtlSeconds', '']
			]),
			known
		);
		expect(parsed).toMatchObject({
			ok: true,
			name: 'Std',
			fields: {
				allowedProviders: [],
				allowedModels: [],
				rateLimitPerMinute: 0,
				dailyBudgetUsd: 0,
				monthlyBudgetUsd: 0,
				cacheTtlSeconds: null
			},
			unknownModels: []
		});
	});

	it('rejects a model pattern with * before the end', () => {
		const parsed = parsePolicyForm(
			form([
				['name', 'p'],
				['allowedModels', 'gpt-4o, gpt-*-mini']
			]),
			known
		);
		expect(parsed.ok).toBe(false);
		expect(!parsed.ok && parsed.message).toContain('gpt-*-mini');
	});

	it('flags patterns that match no known model without rejecting them', () => {
		const parsed = parsePolicyForm(
			form([
				['name', 'p'],
				['allowedModels', 'gpt-4o*, gtp-4o, my-deployment']
			]),
			known
		);
		expect(parsed.ok && parsed.unknownModels).toEqual(['gtp-4o', 'my-deployment']);
		expect(unknownModelsWarning(['gtp-4o'])).toContain('“gtp-4o”');
		expect(unknownModelsWarning([])).toBeUndefined();
	});
});
