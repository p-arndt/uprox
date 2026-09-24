import { describe, it, expect } from 'vitest';
import {
	inheritedForServiceForm,
	inheritedForTokenForm,
	type PresetLayerRow,
	type ServiceLayerRow
} from '$lib/features/policies/effective-config';

const defaults = { cacheTtlSeconds: 300, dailyBudgetUsd: 500, monthlyBudgetUsd: 5000 };

const policies: (PresetLayerRow & { name: string })[] = [
	{
		id: 'p-std',
		name: 'Standard',
		allowedProviders: ['openai', 'azure'],
		allowedModels: [],
		preferredProvider: null,
		rateLimitPerMinute: 60,
		dailyBudgetUsd: '50',
		monthlyBudgetUsd: '0',
		cacheTtlSeconds: null
	},
	{
		id: 'p-strict',
		name: 'Strict',
		allowedProviders: ['openai'],
		allowedModels: ['gpt-4o*'],
		preferredProvider: 'openai',
		rateLimitPerMinute: 10,
		dailyBudgetUsd: '5',
		monthlyBudgetUsd: '100',
		cacheTtlSeconds: 0
	}
];

const services: (ServiceLayerRow & { name: string })[] = [
	{
		id: 's-billing',
		name: 'billing',
		policyId: 'p-std',
		allowedProviders: null,
		allowedModels: null,
		preferredProvider: 'azure',
		rateLimitPerMinute: 30,
		dailyBudgetUsd: '20',
		monthlyBudgetUsd: null,
		cacheTtlSeconds: 120
	},
	// only id/name known: missing config columns count as unset
	{ id: 's-bare', name: 'bare' }
];

describe('inheritedForTokenForm', () => {
	it('falls through service inline, then service preset, then instance', () => {
		const i = inheritedForTokenForm({
			serviceId: 's-billing',
			policyId: '',
			services,
			policies,
			defaults
		});
		expect(i.rateLimitPerMinute).toBe(30);
		expect(i.cacheTtlSeconds).toBe(120);
		expect(i.preferredProvider).toBe('azure');
		expect(i.allowedProviders).toEqual(['openai', 'azure']);
		// token budgets only inherit from the token preset, never the service
		expect(i.dailyBudgetUsd).toBe(0);
		expect(i.monthlyBudgetUsd).toBe(0);
	});

	it('lets the token preset override the service and narrow its allowlists', () => {
		const i = inheritedForTokenForm({
			serviceId: 's-billing',
			policyId: 'p-strict',
			services,
			policies,
			defaults
		});
		expect(i.rateLimitPerMinute).toBe(10);
		expect(i.cacheTtlSeconds).toBe(0);
		expect(i.preferredProvider).toBe('openai');
		expect(i.allowedProviders).toEqual(['openai']);
		expect(i.allowedModels).toEqual([['gpt-4o*']]);
		expect(i.dailyBudgetUsd).toBe(5);
		expect(i.monthlyBudgetUsd).toBe(100);
	});

	it('changes with the selected service', () => {
		const i = inheritedForTokenForm({
			serviceId: 's-bare',
			policyId: '',
			services,
			policies,
			defaults
		});
		expect(i.rateLimitPerMinute).toBe(0);
		expect(i.cacheTtlSeconds).toBe(300);
		expect(i.allowedProviders).toBeNull();
		expect(i.preferredProvider).toBeNull();
	});

	it('treats a blank or unknown service as contributing nothing', () => {
		for (const serviceId of ['', 'gone']) {
			const i = inheritedForTokenForm({ serviceId, policyId: '', services, policies, defaults });
			expect(i.rateLimitPerMinute).toBe(0);
			expect(i.cacheTtlSeconds).toBe(300);
		}
	});
});

describe('inheritedForServiceForm', () => {
	it('shows the instance defaults without a preset', () => {
		const i = inheritedForServiceForm({ policyId: '', policies, defaults });
		expect(i.cacheTtlSeconds).toBe(300);
		expect(i.rateLimitPerMinute).toBe(0);
		// the service budget is its own scope; the instance ceiling is not inherited
		expect(i.dailyBudgetUsd).toBe(0);
		expect(i.allowedProviders).toBeNull();
	});

	it('shows the selected preset', () => {
		const i = inheritedForServiceForm({ policyId: 'p-std', policies, defaults });
		expect(i.rateLimitPerMinute).toBe(60);
		expect(i.dailyBudgetUsd).toBe(50);
		expect(i.cacheTtlSeconds).toBe(300);
		expect(i.allowedProviders).toEqual(['openai', 'azure']);
	});
});
