import type { InheritedLimits } from '$lib/features/policies/effective-config-view';

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
			? 'Overrides the instance default. Blank = instance default, 0 = off, >0 = TTL.'
			: 'Blank = inherit, 0 = force off, >0 = TTL.'
	};
}

/**
 * Always-visible helper lines under the fields whose meaning is easy to get
 * wrong: the rate limit counts per token even on a service, a service budget is
 * one pot shared by all of its tokens, and lists narrow while numbers override.
 */
export interface InlineLimitHelp {
	/** how the layers combine; shown once at the top of the Access section */
	cascade: string;
	providers: string;
	models: string;
	rate: string;
	budget: string;
	cache: string;
}

export function inlineLimitHelp(scope: InlineLimitScope): InlineLimitHelp {
	const isPolicy = scope === 'policy';
	return {
		cascade: 'Lists only narrow across preset → service → token; numbers override.',
		providers: isPolicy
			? 'None checked = all providers allowed.'
			: 'None checked = no extra restriction here.',
		models: isPolicy
			? 'None = all models allowed. A trailing * matches a prefix, e.g. gpt-4o*.'
			: 'None = no extra restriction here. A trailing * matches a prefix, e.g. gpt-4o*.',
		rate:
			scope === 'service'
				? 'Counted per token: each token of this service gets this many. 0 = unlimited.'
				: isPolicy
					? 'Always counted per token. 0 = unlimited.'
					: 'Counted per token. 0 = unlimited.',
		budget:
			scope === 'service'
				? 'One budget shared by all of this service’s tokens. 0 = unlimited.'
				: scope === 'token'
					? 'This token’s own spend; the service budget applies on top. 0 = unlimited.'
					: 'Attached to a service: one budget shared by its tokens. Attached to a token: that token’s cap. 0 = unlimited.',
		cache: isPolicy ? 'Blank = instance default, 0 = off.' : '0 = off.'
	};
}

/**
 * Whether the preferred OpenAI backend can matter: only when both OpenAI and
 * Azure stay reachable. `checked` is this layer's provider list (empty = no
 * restriction here); `inherited` is what the layers below allow (null or
 * undefined = all providers).
 */
export function preferredBackendRelevant(
	checked: string[],
	inherited: string[] | null | undefined
): boolean {
	const reachable = (id: string) =>
		(checked.length === 0 || checked.includes(id)) && (inherited == null || inherited.includes(id));
	return reachable('openai') && reachable('azure');
}

/** Placeholder and summary text for the limits form, derived from what it inherits. */
export interface InheritedText {
	rate: string;
	daily: string;
	monthly: string;
	cache: string;
	/** label of the "inherit" option in the preferred backend select */
	preferred: string;
	/** visible line under the provider checkboxes, or null */
	providers: string | null;
	/** placeholder of the models input, or null to keep the example */
	models: string | null;
	/** section summaries shown while a section holds no custom values */
	limitsSummary: string;
	accessSummary: string;
	advancedSummary: string;
}

const inheritedNum = (n: number | undefined, zero: string) =>
	n === undefined ? 'inherit' : `${n > 0 ? n : zero} (inherited)`;

const present = <T>(parts: (T | null)[]): T[] => parts.filter((p): p is T => p !== null);

/** "60 req/min", "$5/day · $50/month" for the Limits section summary. */
function inheritedLimitsParts(i: InheritedLimits): string[] {
	const budget = present([
		i.dailyBudgetUsd ? `$${i.dailyBudgetUsd}/day` : null,
		i.monthlyBudgetUsd ? `$${i.monthlyBudgetUsd}/month` : null
	]);
	return present([
		i.rateLimitPerMinute === undefined
			? null
			: i.rateLimitPerMinute > 0
				? `${i.rateLimitPerMinute} req/min`
				: 'no rate limit',
		i.dailyBudgetUsd === undefined && i.monthlyBudgetUsd === undefined
			? null
			: budget.length
				? budget.join(' · ')
				: 'no budget'
	]);
}

/**
 * Text for the blank state of each field. Without `inherited` everything reads
 * a bare "inherit", matching forms that don't know their cascade.
 */
export function inheritedText(
	inherited: InheritedLimits | undefined,
	providerLabel: (id: string) => string = (id) => id
): InheritedText {
	const i = inherited ?? {};
	const providers =
		i.allowedProviders === undefined
			? null
			: i.allowedProviders === null
				? 'Inherited: all providers'
				: `Inherited: ${i.allowedProviders.map(providerLabel).join(', ') || 'none'}`;
	const models =
		i.allowedModels === undefined || i.allowedModels.length === 0
			? null
			: `inherited: ${i.allowedModels.map((l) => l.join(', ')).join(' ∩ ')}`;
	const preferred =
		i.preferredProvider === undefined
			? 'Inherit'
			: `Inherit (${i.preferredProvider ? providerLabel(i.preferredProvider) : 'no preference'})`;

	const accessParts = present([
		i.allowedProviders === undefined
			? null
			: i.allowedProviders === null
				? 'all providers'
				: 'some providers',
		models === null ? null : 'restricted models'
	]);
	const summarize = (parts: string[]) =>
		parts.length ? `Inherited: ${parts.join(', ')}` : 'Inherited';

	return {
		rate: inheritedNum(i.rateLimitPerMinute, 'unlimited'),
		daily: inheritedNum(i.dailyBudgetUsd, 'unlimited'),
		monthly: inheritedNum(i.monthlyBudgetUsd, 'unlimited'),
		cache: inheritedNum(i.cacheTtlSeconds, 'off'),
		preferred,
		providers,
		models,
		limitsSummary: summarize(inheritedLimitsParts(i)),
		accessSummary: summarize(accessParts),
		advancedSummary: summarize(
			i.cacheTtlSeconds === undefined
				? []
				: [`cache ${i.cacheTtlSeconds > 0 ? `${i.cacheTtlSeconds} s` : 'off'}`]
		)
	};
}
