/** Client-side pricing types and helpers for the Model Prices page. */

/**
 * Prompt size at which a request flips to a model's long-context rate card.
 * Defined here rather than in the server price module so the dashboard can label
 * the tier without pulling server code into the client bundle; the cost
 * calculation imports this same constant.
 */
export const LONG_CONTEXT_MIN_PROMPT_TOKENS = 272_000;

/** A model price augmented with its resolved provider, the unit the table renders. */
export interface PriceRow {
	id: string | null;
	model: string;
	provider: string | null;
	inputPerMtok: number;
	outputPerMtok: number;
	cacheReadPerMtok: number | null;
	cacheWritePerMtok: number | null;
	longInputPerMtok: number | null;
	longOutputPerMtok: number | null;
	longCacheReadPerMtok: number | null;
	longCacheWritePerMtok: number | null;
	source: 'default' | 'custom';
	defaultInputPerMtok: number | null;
	defaultOutputPerMtok: number | null;
	defaultCacheReadPerMtok: number | null;
	defaultCacheWritePerMtok: number | null;
	defaultLongInputPerMtok: number | null;
	defaultLongOutputPerMtok: number | null;
	defaultLongCacheReadPerMtok: number | null;
	defaultLongCacheWritePerMtok: number | null;
	providerKey: string;
	providerLabel: string;
}

/** The rate card a row is being viewed or edited under. */
export type PriceTier = 'standard' | 'long';

/** Form field names for a tier — the long card mirrors the standard one 1:1. */
export const TIER_FIELDS = {
	standard: {
		input: 'inputPerMtok',
		output: 'outputPerMtok',
		cacheRead: 'cacheReadPerMtok',
		cacheWrite: 'cacheWritePerMtok'
	},
	long: {
		input: 'longInputPerMtok',
		output: 'longOutputPerMtok',
		cacheRead: 'longCacheReadPerMtok',
		cacheWrite: 'longCacheWritePerMtok'
	}
} as const;

/** The four rates a row shows for the selected tier, with the default beneath each. */
export function tierValues(price: PriceRow, tier: PriceTier) {
	if (tier === 'long')
		return {
			input: price.longInputPerMtok,
			output: price.longOutputPerMtok,
			cacheRead: price.longCacheReadPerMtok,
			cacheWrite: price.longCacheWritePerMtok,
			defaultInput: price.defaultLongInputPerMtok,
			defaultOutput: price.defaultLongOutputPerMtok
		};
	return {
		input: price.inputPerMtok,
		output: price.outputPerMtok,
		cacheRead: price.cacheReadPerMtok,
		cacheWrite: price.cacheWritePerMtok,
		defaultInput: price.defaultInputPerMtok,
		defaultOutput: price.defaultOutputPerMtok
	};
}

/** Best-effort provider id from a model name, for rows without an explicit one. */
export function inferProviderId(model: string): string | null {
	const m = model.toLowerCase();
	if (m.startsWith('claude')) return 'anthropic';
	if (m.startsWith('gpt') || /^o\d/.test(m)) return 'openai';
	return null;
}

/** The tab key for prices whose provider is neither set nor inferable. */
export const OTHER_PROVIDER_KEY = '__other';

/** A provider as offered in the pricing page's filters. */
export interface ProviderOption {
	id: string;
	label: string;
}

/** Tag every price with its provider (explicit, else inferred from the model name). */
export function tagPriceProviders<T extends { model: string; provider?: string | null }>(
	prices: T[],
	providers: ProviderOption[]
): (T & { providerKey: string; providerLabel: string })[] {
	const labels = new Map(providers.map((p) => [p.id, p.label] as const));
	return prices.map((p) => {
		const id = p.provider || inferProviderId(p.model);
		return {
			...p,
			providerKey: id ?? OTHER_PROVIDER_KEY,
			providerLabel: id ? (labels.get(id) ?? id) : 'Other'
		};
	});
}

export interface ProviderTab {
	key: string;
	label: string;
	count: number;
}

/**
 * One filter tab per provider that actually has models, in declared provider
 * order, unknown providers after them and "Other" last, each with its count.
 */
export function providerTabs(
	rows: { providerKey: string }[],
	providers: ProviderOption[]
): ProviderTab[] {
	const labels = new Map(providers.map((p) => [p.id, p.label] as const));
	const counts = new Map<string, number>();
	for (const r of rows) counts.set(r.providerKey, (counts.get(r.providerKey) ?? 0) + 1);
	const order = providers.map((p) => p.id);
	const rank = (key: string) => {
		const i = key === OTHER_PROVIDER_KEY ? order.length : order.indexOf(key);
		return i === -1 ? order.length : i;
	};
	return [...counts.keys()]
		.sort((a, b) => rank(a) - rank(b))
		.map((key) => ({
			key,
			label: key === OTHER_PROVIDER_KEY ? 'Other' : (labels.get(key) ?? key),
			count: counts.get(key) ?? 0
		}));
}
