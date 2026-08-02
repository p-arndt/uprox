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
