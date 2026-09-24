import { describe, expect, it } from 'vitest';
import {
	budgetSourceLabel,
	effectiveConfigRows,
	formatBudget,
	formatCacheTtl,
	formatRate,
	fromLabel,
	intersectLists,
	narrowedByLabel,
	sourceLabel,
	toInheritedLimits,
	type ExplainedConfig,
	type SourcedBudget
} from '$lib/features/policies/effective-config-view';

const svc = { layer: 'service', name: 'billing' } as const;
const preset = { layer: 'servicePreset', name: 'Default' } as const;

const budget = (daily: number, monthly: number, source = svc): SourcedBudget => ({
	daily: { value: daily, source: daily ? source : null },
	monthly: { value: monthly, source: monthly ? source : null }
});

describe('source labels', () => {
	it('names every layer', () => {
		expect(sourceLabel({ layer: 'token', name: 'ci' })).toBe('token');
		expect(sourceLabel({ layer: 'tokenPreset', name: 'Strict' })).toBe('token preset Strict');
		expect(sourceLabel(svc)).toBe('service billing');
		expect(sourceLabel(preset)).toBe('service preset Default');
		expect(sourceLabel({ layer: 'instance', name: null })).toBe('instance default');
		expect(sourceLabel({ layer: 'service', name: null })).toBe('service');
	});

	it('prefixes "from" and falls back when unset', () => {
		expect(fromLabel(svc)).toBe('from service billing');
		expect(fromLabel(null)).toBe('not set anywhere');
	});

	it('lists the layers that narrow an allowlist', () => {
		expect(narrowedByLabel([])).toBe('no layer restricts this');
		expect(
			narrowedByLabel([
				{ values: ['a'], source: { layer: 'token', name: null } },
				{ values: ['a'], source: preset }
			])
		).toBe('narrowed by token, service preset Default');
	});
});

describe('value formatting', () => {
	it('states the rate is per token', () => {
		expect(formatRate(60)).toBe('60 req/min per token');
		expect(formatRate(0)).toBe('Unlimited');
	});

	it('formats budgets and omits unlimited windows', () => {
		expect(formatBudget(budget(50, 1000))).toBe('$50.00/day · $1,000.00/month');
		expect(formatBudget(budget(0, 12.5))).toBe('$12.50/month');
		expect(formatBudget(budget(0, 0))).toBe('Unlimited');
	});

	it('splits the budget source only when the windows differ', () => {
		expect(budgetSourceLabel(budget(5, 10))).toBe('from service billing');
		const mixed: SourcedBudget = {
			daily: { value: 5, source: svc },
			monthly: { value: 10, source: preset }
		};
		expect(budgetSourceLabel(mixed)).toBe(
			'daily from service billing; monthly from service preset Default'
		);
	});

	it('shows cache TTL 0 as off', () => {
		expect(formatCacheTtl(0)).toBe('Off');
		expect(formatCacheTtl(300)).toBe('300 s');
	});
});

describe('intersectLists', () => {
	it('is null (all) without lists and intersects otherwise', () => {
		expect(intersectLists([])).toBeNull();
		expect(
			intersectLists([
				{ values: ['openai', 'azure'], source: svc },
				{ values: ['azure', 'anthropic'], source: preset }
			])
		).toEqual(['azure']);
	});
});

describe('toInheritedLimits', () => {
	const config: ExplainedConfig = {
		providers: [{ values: ['openai'], source: svc }],
		models: [{ values: ['gpt-4o*'], source: preset }],
		preferredProvider: { value: 'azure', source: svc },
		rateLimitPerMinute: { value: 60, source: svc },
		cacheTtlSeconds: { value: 120, source: { layer: 'instance', name: null } },
		tokenBudget: budget(1, 2),
		serviceBudget: budget(50, 500),
		instanceBudget: budget(0, 0)
	};

	it('takes the budget of the edited scope', () => {
		expect(toInheritedLimits(config, 'token')).toEqual({
			rateLimitPerMinute: 60,
			dailyBudgetUsd: 1,
			monthlyBudgetUsd: 2,
			cacheTtlSeconds: 120,
			preferredProvider: 'azure',
			allowedProviders: ['openai'],
			allowedModels: [['gpt-4o*']]
		});
		expect(toInheritedLimits(config, 'service').dailyBudgetUsd).toBe(50);
	});

	it('treats a missing token budget as unlimited', () => {
		expect(toInheritedLimits({ ...config, tokenBudget: null }, 'token').dailyBudgetUsd).toBe(0);
	});
});

describe('effectiveConfigRows', () => {
	const config: ExplainedConfig = {
		providers: [
			{ values: ['openai', 'azure'], source: { layer: 'token', name: 'ci' } },
			{ values: ['azure'], source: preset }
		],
		models: [],
		preferredProvider: { value: null, source: null },
		rateLimitPerMinute: { value: 60, source: svc },
		cacheTtlSeconds: { value: 0, source: { layer: 'instance', name: null } },
		tokenBudget: budget(0, 0),
		serviceBudget: budget(50, 0),
		instanceBudget: budget(0, 0)
	};
	const byKey = (rows: ReturnType<typeof effectiveConfigRows>) =>
		Object.fromEntries(rows.map((r) => [r.key, r]));

	it('spells out the per-token rate and the shared service budget for a token', () => {
		const rows = byKey(
			effectiveConfigRows(config, {
				subject: 'token',
				serviceName: 'billing',
				providerLabels: { azure: 'Azure OpenAI' }
			})
		);
		expect(rows['Rate limit']).toEqual({
			key: 'Rate limit',
			value: '60 req/min per token',
			source: 'from service billing'
		});
		expect(rows['Service budget']?.value).toBe(
			'$50.00/day shared by all tokens of service billing'
		);
		expect(rows['Token budget']?.value).toBe('Unlimited');
		expect(rows['Providers']).toMatchObject({
			value: 'Azure OpenAI',
			source: 'narrowed by token, service preset Default'
		});
		expect(rows['Models']?.value).toBe('All models');
		expect(rows['Cache TTL']).toMatchObject({ value: 'Off', source: 'from instance default' });
	});

	it('omits the token budget and notes per-token counting for a service', () => {
		const rows = effectiveConfigRows({ ...config, tokenBudget: null }, { subject: 'service' });
		expect(rows.map((r) => r.key)).not.toContain('Token budget');
		expect(byKey(rows)['Rate limit']?.source).toBe(
			'from service billing · each token counted separately'
		);
		expect(byKey(rows)['Service budget']?.value).toBe(
			'$50.00/day shared by all tokens of this service'
		);
	});
});
