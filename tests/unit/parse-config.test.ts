import { describe, expect, it } from 'vitest';
import { inlineFromForm, splitList } from '$lib/server/parse-config';

function form(entries: [string, string][]): FormData {
	const fd = new FormData();
	for (const [k, v] of entries) fd.append(k, v);
	return fd;
}

describe('splitList', () => {
	it('splits, trims and drops blanks', () => {
		expect(splitList(' gpt-4o, ,claude-* ')).toEqual(['gpt-4o', 'claude-*']);
		expect(splitList(null)).toEqual([]);
	});
});

describe('inlineFromForm', () => {
	const full = form([
		['allowedProviders', 'openai'],
		['allowedProviders', 'azure'],
		['allowedModels', 'gpt-4o, o3'],
		['preferredProvider', ''],
		['rateLimitPerMinute', '60'],
		['dailyBudgetUsd', ''],
		['monthlyBudgetUsd', '12.5'],
		['cacheTtlSeconds', '0']
	]);

	it('parses every field, blanks clearing the override', () => {
		expect(inlineFromForm(full, { includeModels: true })).toEqual({
			allowedProviders: ['openai', 'azure'],
			allowedModels: ['gpt-4o', 'o3'],
			preferredProvider: null,
			rateLimitPerMinute: 60,
			dailyBudgetUsd: null,
			monthlyBudgetUsd: 12.5,
			cacheTtlSeconds: 0
		});
	});

	it('leaves allowedModels out unless asked', () => {
		expect(inlineFromForm(full)).not.toHaveProperty('allowedModels');
	});

	it('omits invalid numbers and clears fields missing from the form', () => {
		const out = inlineFromForm(form([['rateLimitPerMinute', '-1']]));
		expect(out).not.toHaveProperty('rateLimitPerMinute');
		// a form field that wasn't posted reads as null, i.e. inherit
		expect(out.cacheTtlSeconds).toBeNull();
		expect(out.allowedProviders).toEqual([]);
	});
});
