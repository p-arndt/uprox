import { describe, expect, it } from 'vitest';
import {
	deleteServiceDescription,
	serviceSettingRows,
	type ServiceSettings
} from '../../src/routes/app/services/service-display';

const unset: ServiceSettings = {
	presetName: null,
	rateLimitPerMinute: null,
	dailyBudgetUsd: null,
	monthlyBudgetUsd: null,
	allowedProviders: null,
	allowedModels: null,
	cacheTtlSeconds: null,
	upstreamKeyLabel: null
};

const byLabel = (rows: ReturnType<typeof serviceSettingRows>) =>
	Object.fromEntries(rows.map((r) => [r.label, r.value]));

describe('deleteServiceDescription', () => {
	it('states how many active tokens get revoked', () => {
		expect(deleteServiceDescription(0)).toMatch(/^This service has no active tokens\./);
		expect(deleteServiceDescription(1)).toMatch(/^1 active token will be revoked/);
		expect(deleteServiceDescription(3)).toMatch(/^3 active tokens will be revoked/);
	});
});

describe('serviceSettingRows', () => {
	it('shows Inherited for unset limits, and None / Automatic for preset and key', () => {
		const rows = serviceSettingRows(unset);
		expect(byLabel(rows)).toEqual({
			Preset: 'None',
			'Rate limit': 'Inherited',
			'Daily budget': 'Inherited',
			'Monthly budget': 'Inherited',
			'Allowed providers': 'Inherited',
			'Allowed models': 'Inherited',
			'Cache TTL': 'Inherited',
			'Upstream key': 'Automatic (default key)'
		});
		expect(rows.filter((r) => r.inherited)).toHaveLength(6);
	});

	it('reads zero and empty values as explicit settings', () => {
		const rows = serviceSettingRows({
			...unset,
			rateLimitPerMinute: 0,
			dailyBudgetUsd: '0.0000',
			allowedProviders: [],
			cacheTtlSeconds: 0
		});
		expect(byLabel(rows)).toMatchObject({
			'Rate limit': 'Unlimited',
			'Daily budget': 'Unlimited',
			'Allowed providers': 'All',
			'Cache TTL': 'Off'
		});
	});

	it('formats set values', () => {
		const rows = serviceSettingRows(
			{
				presetName: 'Strict',
				rateLimitPerMinute: 60,
				dailyBudgetUsd: '5.0000',
				monthlyBudgetUsd: 100,
				allowedProviders: ['openai', 'azure'],
				allowedModels: ['gpt-4o*'],
				cacheTtlSeconds: 300,
				upstreamKeyLabel: 'Azure OpenAI — eu'
			},
			(id) => id.toUpperCase()
		);
		expect(byLabel(rows)).toEqual({
			Preset: 'Strict',
			'Rate limit': '60 req/min',
			'Daily budget': '$5.00',
			'Monthly budget': '$100.00',
			'Allowed providers': 'OPENAI, AZURE',
			'Allowed models': 'gpt-4o*',
			'Cache TTL': '300s',
			'Upstream key': 'Azure OpenAI — eu'
		});
		expect(rows.every((r) => !r.inherited)).toBe(true);
	});
});
