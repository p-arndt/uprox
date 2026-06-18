/**
 * Token-based cache rate, shared by every usage view (overview tile, usage page,
 * and the per-service / per-token detail pages) so the definition lives in one
 * place.
 *
 * The rate combines both caching layers:
 *  - uprox's own response cache (`savedInputTokens`) — replayed requests that
 *    never reached the provider.
 *  - the provider's prompt cache (`providerCachedTokens`) — the cache-read subset
 *    of input that did go upstream.
 *
 * The denominator is the input that's actually *eligible* for caching: upstream
 * input minus embeddings (which providers never prompt-cache) plus tokens served
 * from uprox's cache. Counting non-cacheable embedding volume would understate
 * the rate, so it's always excluded — see the usage pages for context.
 */
export interface CacheRateInput {
	/** total input tokens billed by upstream (includes any provider-cached subset) */
	inputTokens: number;
	/** input tokens attributable to embedding models — never cacheable */
	embeddingInputTokens: number;
	/** input tokens uprox's response cache saved (replayed from the stored miss) */
	savedInputTokens: number;
	/** input tokens the provider served from its own prompt cache (cache reads) */
	providerCachedTokens: number;
}

export interface CacheRate {
	/** input eligible for caching: upstream input − embeddings + uprox replays */
	cacheableInput: number;
	/** input that benefited from a cache layer: provider reads + uprox replays */
	cachedInput: number;
	/** `cachedInput / cacheableInput`, or 0 when there's no cacheable input */
	rate: number;
}

export function cacheRate(t: CacheRateInput): CacheRate {
	const cacheableInput = t.inputTokens - t.embeddingInputTokens + t.savedInputTokens;
	const cachedInput = t.providerCachedTokens + t.savedInputTokens;
	return {
		cacheableInput,
		cachedInput,
		rate: cacheableInput > 0 ? cachedInput / cacheableInput : 0
	};
}
