import { describe, expect, it } from 'vitest';
import {
	inheritedText,
	inlineLimitHelp,
	inlineLimitHints,
	preferredBackendRelevant
} from '$lib/features/policies/inline-limits-hints';

describe('inlineLimitHints', () => {
	it('describes a policy as the concrete base layer', () => {
		const h = inlineLimitHints('policy');
		expect(h.rate).toBe('0 = unlimited.');
		expect(h.budget).toBe(
			'Spend ceiling for whatever inherits this preset. 0 = unlimited. UTC windows.'
		);
		expect(h.providers).toBe('None checked = all providers allowed.');
	});

	it('describes token and service limits as inheriting overrides', () => {
		expect(inlineLimitHints('token').budget).toBe(
			"This token's spend cap, on top of the service ceiling. Blank = inherit, 0 = unlimited. UTC windows."
		);
		expect(inlineLimitHints('service').budget).toBe(
			'Aggregate ceiling across all of this service’s tokens. Blank = inherit, 0 = unlimited. UTC windows.'
		);
		expect(inlineLimitHints('service').rate).toBe('Blank = inherit, 0 = unlimited.');
	});
});

describe('inlineLimitHelp', () => {
	it('spells out per-token rate vs shared service budget', () => {
		const svc = inlineLimitHelp('service');
		expect(svc.rate).toContain('per token');
		expect(svc.budget).toContain('shared by all');
		expect(inlineLimitHelp('token').budget).toContain('service budget applies on top');
		expect(inlineLimitHelp('token').rate).toBe('Counted per token. 0 = unlimited.');
	});

	it('spells out what a preset budget, rate and blank cache mean', () => {
		const p = inlineLimitHelp('policy');
		expect(p.rate).toBe('Always counted per token. 0 = unlimited.');
		expect(p.budget).toContain('Attached to a service: one budget shared by its tokens');
		expect(p.budget).toContain('Attached to a token: that token’s cap');
		expect(p.cache).toBe('Blank = instance default, 0 = off.');
		expect(p.providers).toBe('None checked = all providers allowed.');
		expect(p.models).toContain('None = all models allowed');
		expect(p.cascade).toBe('Lists only narrow across preset → service → token; numbers override.');
	});
});

describe('preferredBackendRelevant', () => {
	it('needs both OpenAI and Azure reachable', () => {
		expect(preferredBackendRelevant([], null)).toBe(true);
		expect(preferredBackendRelevant([], undefined)).toBe(true);
		expect(preferredBackendRelevant(['openai', 'azure', 'anthropic'], null)).toBe(true);
		expect(preferredBackendRelevant(['openai'], null)).toBe(false);
		expect(preferredBackendRelevant(['anthropic'], null)).toBe(false);
	});

	it('respects what the lower layers already restrict', () => {
		expect(preferredBackendRelevant([], ['openai'])).toBe(false);
		expect(preferredBackendRelevant(['openai', 'azure'], ['openai', 'azure'])).toBe(true);
		expect(preferredBackendRelevant(['openai', 'azure'], ['azure'])).toBe(false);
	});
});

describe('inheritedText', () => {
	it('falls back to a bare "inherit" without inherited values', () => {
		const t = inheritedText(undefined);
		expect(t.rate).toBe('inherit');
		expect(t.daily).toBe('inherit');
		expect(t.cache).toBe('inherit');
		expect(t.preferred).toBe('Inherit');
		expect(t.providers).toBeNull();
		expect(t.models).toBeNull();
		expect(t.limitsSummary).toBe('Inherited');
		expect(t.accessSummary).toBe('Inherited');
		expect(t.advancedSummary).toBe('Inherited');
	});

	it('shows the inherited values', () => {
		const t = inheritedText(
			{
				rateLimitPerMinute: 60,
				dailyBudgetUsd: 50,
				monthlyBudgetUsd: 0,
				cacheTtlSeconds: 0,
				preferredProvider: 'azure',
				allowedProviders: ['openai', 'azure'],
				allowedModels: [['gpt-4o*'], ['gpt-4o-mini']]
			},
			(id) => id.toUpperCase()
		);
		expect(t.rate).toBe('60 (inherited)');
		expect(t.daily).toBe('50 (inherited)');
		expect(t.monthly).toBe('unlimited (inherited)');
		expect(t.cache).toBe('off (inherited)');
		expect(t.preferred).toBe('Inherit (AZURE)');
		expect(t.providers).toBe('Inherited: OPENAI, AZURE');
		expect(t.models).toBe('inherited: gpt-4o* ∩ gpt-4o-mini');
		expect(t.limitsSummary).toBe('Inherited: 60 req/min, $50/day');
		expect(t.accessSummary).toBe('Inherited: some providers, restricted models');
		expect(t.advancedSummary).toBe('Inherited: cache off');
	});

	it('names the unrestricted cases', () => {
		const t = inheritedText({
			rateLimitPerMinute: 0,
			dailyBudgetUsd: 0,
			monthlyBudgetUsd: 0,
			preferredProvider: null,
			allowedProviders: null,
			allowedModels: []
		});
		expect(t.providers).toBe('Inherited: all providers');
		expect(t.preferred).toBe('Inherit (no preference)');
		expect(t.limitsSummary).toBe('Inherited: no rate limit, no budget');
		expect(t.accessSummary).toBe('Inherited: all providers');
	});
});
