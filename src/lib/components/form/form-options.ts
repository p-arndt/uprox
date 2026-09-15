/** Option lists and placeholders shared by the entity forms and dialogs. */

export interface SelectOption {
	value: string;
	label: string;
}

/** Policy presets, led by the "none attached" choice ('' on submit). */
export function presetOptions(policies: { id: string; name: string }[]): SelectOption[] {
	return [
		{ value: '', label: 'No preset' },
		...policies.map((p) => ({ value: p.id, label: p.name }))
	];
}

/** Example endpoint URL for providers that need one, matching the provider's hint text. */
export function endpointPlaceholder(provider: string | undefined): string {
	if (provider === 'custom') return 'https://api.groq.com/openai/v1';
	if (provider === 'ollama') return 'http://localhost:11434';
	return 'https://my-resource.openai.azure.com';
}
