import { describe, expect, it } from 'vitest';
import { OTHER_PROVIDER_KEY, providerTabs, tagPriceProviders } from '$lib/pricing';
import { isNavActive, navItemFor } from '$lib/nav';
import { formatBudget } from '../../src/routes/app/policies/budget-label';

const providers = [
	{ id: 'openai', label: 'OpenAI' },
	{ id: 'anthropic', label: 'Anthropic' },
	{ id: 'azure', label: 'Azure OpenAI' }
];

describe('tagPriceProviders', () => {
	it('uses the explicit provider, else infers it from the model name', () => {
		const rows = tagPriceProviders(
			[
				{ model: 'gpt-4o', provider: 'azure' },
				{ model: 'claude-sonnet', provider: null },
				{ model: 'o3-mini', provider: null },
				{ model: 'mistral-large', provider: null },
				{ model: 'custom', provider: 'unknown-co' }
			],
			providers
		);
		expect(rows.map((r) => [r.providerKey, r.providerLabel])).toEqual([
			['azure', 'Azure OpenAI'],
			['anthropic', 'Anthropic'],
			['openai', 'OpenAI'],
			[OTHER_PROVIDER_KEY, 'Other'],
			['unknown-co', 'unknown-co']
		]);
	});
});

describe('providerTabs', () => {
	it('orders tabs by declared provider order; unknown providers and Other follow in first-seen order', () => {
		const tabs = providerTabs(
			[
				{ providerKey: OTHER_PROVIDER_KEY },
				{ providerKey: 'anthropic' },
				{ providerKey: 'unknown-co' },
				{ providerKey: 'openai' },
				{ providerKey: 'anthropic' }
			],
			providers
		);
		expect(tabs).toEqual([
			{ key: 'openai', label: 'OpenAI', count: 1 },
			{ key: 'anthropic', label: 'Anthropic', count: 2 },
			{ key: OTHER_PROVIDER_KEY, label: 'Other', count: 1 },
			{ key: 'unknown-co', label: 'unknown-co', count: 1 }
		]);
	});

	it('is empty without rows', () => {
		expect(providerTabs([], providers)).toEqual([]);
	});
});

describe('nav matching', () => {
	const items = [
		{ href: '/app', exact: true },
		{ href: '/app/services' },
		{ href: '/app/tokens' }
	] as const;

	it('matches prefix items for detail pages', () => {
		expect(isNavActive('/app/services/abc', { href: '/app/services' } as never)).toBe(true);
		expect(navItemFor('/app/tokens/xyz', [...items] as never[])).toEqual({ href: '/app/tokens' });
	});

	it('matches exact items only on the exact path', () => {
		expect(isNavActive('/app/usage', { href: '/app', exact: true } as never)).toBe(false);
		expect(navItemFor('/app', [...items] as never[])).toEqual({ href: '/app', exact: true });
		expect(navItemFor('/elsewhere', [...items] as never[])).toBeUndefined();
	});
});

describe('formatBudget', () => {
	it('lists the set ceilings', () => {
		expect(formatBudget('5', 0)).toBe('$5/day');
		expect(formatBudget(0, '100.50')).toBe('$100.5/mo');
		expect(formatBudget(5, 100)).toBe('$5/day · $100/mo');
	});

	it('says when there is no budget', () => {
		expect(formatBudget('0', 0)).toBe('No budget');
	});
});
