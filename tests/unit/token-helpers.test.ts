import { describe, it, expect } from 'vitest';
import {
	initialServiceId,
	servicePickerOptions,
	tokenPresetLabel
} from '$lib/features/tokens/token-helpers';

const services = [
	{ id: 's-billing', name: 'Billing' },
	{ id: 's-default', name: 'Default' }
];

describe('initialServiceId', () => {
	it('preselects the real Default service', () => {
		expect(initialServiceId(services)).toBe('s-default');
	});

	it('prefers a requested service that exists', () => {
		expect(initialServiceId(services, 's-billing')).toBe('s-billing');
	});

	it('ignores an unknown requested service', () => {
		expect(initialServiceId(services, 'gone')).toBe('s-default');
	});

	it('falls back to blank when Default does not exist yet', () => {
		expect(initialServiceId([{ id: 's-billing', name: 'Billing' }])).toBe('');
		expect(initialServiceId([], null)).toBe('');
	});
});

describe('tokenPresetLabel', () => {
	it("shows the token's own preset first", () => {
		expect(tokenPresetLabel({ policyName: 'Strict', servicePolicyName: 'Loose' })).toEqual({
			source: 'token',
			name: 'Strict'
		});
	});

	it("falls back to the service's preset", () => {
		expect(tokenPresetLabel({ policyName: null, servicePolicyName: 'Loose' })).toEqual({
			source: 'service',
			name: 'Loose'
		});
	});

	it('reports none when neither has a preset', () => {
		expect(tokenPresetLabel({ policyName: null, servicePolicyName: null })).toEqual({
			source: 'none'
		});
		expect(tokenPresetLabel({ policyName: null })).toEqual({ source: 'none' });
	});
});

describe('servicePickerOptions', () => {
	it('puts Default first, sorts the rest by name and flags duplicate names', () => {
		const options = servicePickerOptions([
			{ id: 'z', name: 'zeta' },
			{ id: 'a1', name: 'alpha' },
			{ id: 'd', name: 'Default' },
			{ id: 'a2', name: 'Alpha' }
		]);
		expect(options.map((o) => o.id)).toEqual(['d', 'a1', 'a2', 'z']);
		expect(options.filter((o) => o.duplicate).map((o) => o.id)).toEqual(['a1', 'a2']);
	});
});
