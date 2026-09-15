/**
 * Rate cards for the meter allocations.
 *
 * Prices come from the same cached effective price map the gateway bills with
 * (see `getEffectivePriceMap` in pricing.ts) and are matched with the same
 * longest-prefix resolver, so analytics and enforcement can never disagree
 * about which rate card a model is on.
 */
import type { MeterRates } from '$lib/features/usage/meters';
import { resolvePrice, type ModelPrice } from '$lib/server/providers';

export { getEffectivePriceMap as loadRateCards } from '$lib/server/pricing';

/**
 * A model price as meter rates for one context tier.
 *
 * The long card is used only when the request recorded that tier *and* the model
 * publishes one (`longIn`); its output rate falls back to the standard output
 * rate, and its cache rates stay unset so the multiplier fallback applies to the
 * long input rate — the same rules `tierForPromptTokens` bills with.
 */
export function meterRatesFor(price: ModelPrice, tier: string | null): MeterRates {
	if (tier === 'long' && price.longIn != null) {
		return {
			inputPerMtok: price.longIn,
			outputPerMtok: price.longOut ?? price.out,
			cacheReadPerMtok: price.longCacheRead ?? null,
			cacheWritePerMtok: price.longCacheWrite ?? null
		};
	}
	return {
		inputPerMtok: price.in,
		outputPerMtok: price.out,
		cacheReadPerMtok: price.cacheRead ?? null,
		cacheWritePerMtok: price.cacheWrite ?? null
	};
}

/**
 * The rates a group billed at: the long-context card when the request recorded
 * that tier and the model publishes one, else the standard card.
 *
 * A model with no price row at all returns null, which prices its meters at
 * nothing — the caller then falls back to a token-share allocation rather than
 * letting an unpriced model claim a share of a priced one's spend.
 */
export function ratesFor(
	prices: Record<string, ModelPrice>,
	model: string | null,
	tier: string | null
): MeterRates | null {
	if (!model) return null;
	const price = resolvePrice(prices, model);
	return price ? meterRatesFor(price, tier) : null;
}
