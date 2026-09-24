/**
 * Effective config WITH provenance, plus the pure formatting used to show it.
 * The server resolves it (explainEffectiveConfig in $lib/server/effective-config);
 * this module holds only plain data types and formatters so client components
 * can import it without pulling in server code.
 */
import { formatUsd } from '$lib/format';

/** The five cascade layers, most specific first. */
export type ConfigLayer = 'token' | 'tokenPreset' | 'service' | 'servicePreset' | 'instance';

/** Where a value came from. `name` is the token/preset/service name, if known. */
export interface ConfigSource {
	layer: ConfigLayer;
	name: string | null;
}

/** A resolved value and the layer that supplied it; null source = set nowhere. */
export interface Sourced<T> {
	value: T;
	source: ConfigSource | null;
}

/** One layer's non-empty allowlist. */
export interface SourcedList {
	values: string[];
	source: ConfigSource;
}

export interface SourcedBudget {
	daily: Sourced<number>;
	monthly: Sourced<number>;
}

export interface ExplainedConfig {
	/** every non-empty provider allowlist; a provider must be in ALL. Empty = all allowed. */
	providers: SourcedList[];
	/** every non-empty model allowlist; a model must match ALL. Empty = all allowed. */
	models: SourcedList[];
	preferredProvider: Sourced<string | null>;
	/** requests/min, enforced per token; 0 = unlimited */
	rateLimitPerMinute: Sourced<number>;
	cacheTtlSeconds: Sourced<number>;
	/** null when explaining a service on its own (no token in scope) */
	tokenBudget: SourcedBudget | null;
	/** aggregate across all of the service's tokens */
	serviceBudget: SourcedBudget;
	/** aggregate across all traffic */
	instanceBudget: SourcedBudget;
}

/** "token", "token preset Standard", "service billing", "instance default", … */
export function sourceLabel(source: ConfigSource): string {
	const named = (prefix: string) => (source.name ? `${prefix} ${source.name}` : prefix);
	switch (source.layer) {
		case 'token':
			return 'token';
		case 'tokenPreset':
			return named('token preset');
		case 'service':
			return named('service');
		case 'servicePreset':
			return named('service preset');
		case 'instance':
			return 'instance default';
	}
}

/** "from service billing", or a fallback when no layer set the value. */
export function fromLabel(source: ConfigSource | null, unset = 'not set anywhere'): string {
	return source ? `from ${sourceLabel(source)}` : unset;
}

/** Intersection of the provider allowlists; null = no restriction (all providers). */
export function intersectLists(lists: SourcedList[]): string[] | null {
	const [first, ...rest] = lists;
	if (!first) return null;
	return rest.reduce((acc, l) => acc.filter((v) => l.values.includes(v)), [...first.values]);
}

/** "narrowed by token, service billing" for the layers that contributed a list. */
export function narrowedByLabel(lists: SourcedList[]): string {
	return lists.length === 0
		? 'no layer restricts this'
		: `narrowed by ${lists.map((l) => sourceLabel(l.source)).join(', ')}`;
}

/** "$50/day · $1,000/month", one side omitted when 0, "Unlimited" when both are. */
export function formatBudget(b: SourcedBudget): string {
	const parts = [
		b.daily.value > 0 ? `${formatUsd(b.daily.value)}/day` : null,
		b.monthly.value > 0 ? `${formatUsd(b.monthly.value)}/month` : null
	].filter((p): p is string => p !== null);
	return parts.length ? parts.join(' · ') : 'Unlimited';
}

/**
 * Source line for a budget: a single "from X" when both windows share a layer,
 * otherwise one per window so a mixed origin isn't hidden.
 */
export function budgetSourceLabel(b: SourcedBudget): string {
	const d = b.daily.source;
	const m = b.monthly.source;
	if (d?.layer === m?.layer && d?.name === m?.name) return fromLabel(d);
	return `daily ${fromLabel(d)}; monthly ${fromLabel(m)}`;
}

/** "60 req/min per token" or "Unlimited". The limit is always counted per token. */
export function formatRate(n: number): string {
	return n > 0 ? `${n} req/min per token` : 'Unlimited';
}

export function formatCacheTtl(n: number): string {
	return n > 0 ? `${n} s` : 'Off';
}

export interface SummaryRow {
	key: string;
	value: string;
	/** muted provenance line under the value */
	source: string;
}

/**
 * Key/value rows for the effective-config summary. Budgets get one row per
 * scope because they don't cascade (all apply), and the wording makes the
 * asymmetry explicit: the rate counts per token, a service budget is shared.
 */
export function effectiveConfigRows(
	c: ExplainedConfig,
	opts: {
		subject: 'token' | 'service';
		serviceName?: string;
		providerLabels?: Record<string, string>;
	}
): SummaryRow[] {
	const label = (id: string) => opts.providerLabels?.[id] ?? id;
	const allowed = intersectLists(c.providers);
	const service = opts.serviceName ? `service ${opts.serviceName}` : 'this service';
	const scoped = (b: SourcedBudget, suffix: string) => {
		const text = formatBudget(b);
		return text === 'Unlimited' ? text : `${text} ${suffix}`;
	};
	const rate = c.rateLimitPerMinute;

	return [
		{
			key: 'Rate limit',
			value: formatRate(rate.value),
			source:
				fromLabel(rate.source) +
				(opts.subject === 'service' && rate.value > 0 ? ' · each token counted separately' : '')
		},
		...(c.tokenBudget
			? [
					{
						key: 'Token budget',
						value: scoped(c.tokenBudget, 'for this token'),
						source: budgetSourceLabel(c.tokenBudget)
					}
				]
			: []),
		{
			key: 'Service budget',
			value: scoped(c.serviceBudget, `shared by all tokens of ${service}`),
			source: budgetSourceLabel(c.serviceBudget)
		},
		{
			key: 'Instance budget',
			value: scoped(c.instanceBudget, 'across all traffic'),
			source: 'from instance settings'
		},
		{
			key: 'Providers',
			value:
				allowed === null
					? 'All providers'
					: allowed.length
						? allowed.map(label).join(', ')
						: 'None (the allowlists do not overlap)',
			source: narrowedByLabel(c.providers)
		},
		{
			key: 'Models',
			value: c.models.length
				? c.models.map((l) => l.values.join(', ')).join(' and ')
				: 'All models',
			source:
				c.models.length > 1
					? `${narrowedByLabel(c.models)} · must match every list`
					: narrowedByLabel(c.models)
		},
		{
			key: 'Preferred OpenAI backend',
			value: c.preferredProvider.value ? label(c.preferredProvider.value) : 'No preference',
			source: fromLabel(c.preferredProvider.source)
		},
		{
			key: 'Cache TTL',
			value: formatCacheTtl(c.cacheTtlSeconds.value),
			source: fromLabel(c.cacheTtlSeconds.source)
		}
	];
}

/**
 * The values a blank inline field would fall back to, for the limits form's
 * placeholders. Absent keys render the plain "inherit" placeholder.
 */
export interface InheritedLimits {
	rateLimitPerMinute?: number;
	dailyBudgetUsd?: number;
	monthlyBudgetUsd?: number;
	cacheTtlSeconds?: number;
	preferredProvider?: string | null;
	/** effective inherited provider set; null = all providers */
	allowedProviders?: string[] | null;
	/** inherited model allowlists (a model must match all of them); [] = all models */
	allowedModels?: string[][];
}

/**
 * Map an explained config (computed with the edited layer's inline values blank)
 * to what that layer's form fields inherit. Budgets only inherit within their own
 * scope, so a token form shows the token budget and a service form the service one.
 */
export function toInheritedLimits(
	config: ExplainedConfig,
	scope: 'token' | 'service'
): InheritedLimits {
	const budget = scope === 'token' ? config.tokenBudget : config.serviceBudget;
	return {
		rateLimitPerMinute: config.rateLimitPerMinute.value,
		dailyBudgetUsd: budget?.daily.value ?? 0,
		monthlyBudgetUsd: budget?.monthly.value ?? 0,
		cacheTtlSeconds: config.cacheTtlSeconds.value,
		preferredProvider: config.preferredProvider.value,
		allowedProviders: intersectLists(config.providers),
		allowedModels: config.models.map((l) => l.values)
	};
}
