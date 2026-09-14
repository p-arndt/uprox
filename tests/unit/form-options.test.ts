import { describe, it, expect } from 'vitest';
import { endpointPlaceholder, presetOptions } from '$lib/components/form/form-options';

describe('presetOptions', () => {
	it('leads with the empty "No preset" choice', () => {
		expect(presetOptions([{ id: 'p1', name: 'Strict' }])).toEqual([
			{ value: '', label: 'No preset' },
			{ value: 'p1', label: 'Strict' }
		]);
		expect(presetOptions([])).toEqual([{ value: '', label: 'No preset' }]);
	});
});

describe('endpointPlaceholder', () => {
	it('matches the provider', () => {
		expect(endpointPlaceholder('custom')).toBe('https://api.groq.com/openai/v1');
		expect(endpointPlaceholder('ollama')).toBe('http://localhost:11434');
		expect(endpointPlaceholder('azure')).toBe('https://my-resource.openai.azure.com');
		expect(endpointPlaceholder(undefined)).toBe('https://my-resource.openai.azure.com');
	});
});
