/** Client-side pricing types and helpers for the Model Prices page. */

/** A model price augmented with its resolved provider, the unit the table renders. */
export interface PriceRow {
	id: string | null;
	model: string;
	provider: string | null;
	inputPerMtok: number;
	outputPerMtok: number;
	cacheReadPerMtok: number | null;
	cacheWritePerMtok: number | null;
	source: 'default' | 'custom';
	defaultInputPerMtok: number | null;
	defaultOutputPerMtok: number | null;
	defaultCacheReadPerMtok: number | null;
	defaultCacheWritePerMtok: number | null;
	providerKey: string;
	providerLabel: string;
}

/** Best-effort provider id from a model name, for rows without an explicit one. */
export function inferProviderId(model: string): string | null {
	const m = model.toLowerCase();
	if (m.startsWith('claude')) return 'anthropic';
	if (m.startsWith('gpt') || /^o\d/.test(m)) return 'openai';
	return null;
}
