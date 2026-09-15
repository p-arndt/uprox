/** Which layer an inline limits form edits: a reusable preset or a token/service override. */
export type InlineLimitScope = 'token' | 'service' | 'policy';

/** Hover-hint text for each inline limits field; one short string each. */
export interface InlineLimitHints {
	providers: string;
	models: string;
	preferred: string;
	rate: string;
	budget: string;
	cache: string;
}

/**
 * The hint text for a scope. A policy is the base layer (concrete values, no
 * inherit); a token or service only narrows / overrides its preset.
 */
export function inlineLimitHints(scope: InlineLimitScope): InlineLimitHints {
	const isPolicy = scope === 'policy';
	const budgetScope = isPolicy
		? 'Spend ceiling for whatever inherits this preset.'
		: scope === 'token'
			? "This token's spend cap, on top of the service ceiling."
			: 'Aggregate ceiling across all of this service’s tokens.';
	return {
		providers: isPolicy
			? 'None checked = all providers allowed.'
			: 'None checked = inherits. Only narrows — never widens the preset.',
		models: isPolicy
			? 'Comma-separated, trailing * matches a prefix. Blank = all models.'
			: 'Comma-separated, trailing * matches a prefix. Blank = inherits.',
		preferred:
			'When both OpenAI and Azure are set, which one serves shared models (gpt-*, o-series).',
		rate: isPolicy ? '0 = unlimited.' : 'Blank = inherit, 0 = unlimited.',
		budget:
			budgetScope +
			(isPolicy ? ' 0 = unlimited. UTC windows.' : ' Blank = inherit, 0 = unlimited. UTC windows.'),
		cache: isPolicy
			? 'Overrides the org default. Blank = inherit, 0 = off, >0 = TTL.'
			: 'Blank = inherit, 0 = force off, >0 = TTL.'
	};
}
