/**
 * Derivations for the token-meter card: the composition rows and what the two
 * cache layers avoided.
 */
import { METER_COLOR, METER_META } from '$lib/features/usage/colors';

export interface MeterInput {
	key: string;
	tokens: number;
}

export interface CacheSavingsInput {
	costUsd: number;
	savedUsd: number;
	providerCacheSavedUsd: number;
}

/** Non-empty meters with their display metadata, colour and share of `totalTokens`. */
export function meterRows<M extends MeterInput>(meters: M[], totalTokens: number) {
	return meters
		.filter((m) => m.tokens > 0)
		.map((m) => ({
			...m,
			...METER_META[m.key],
			color: METER_COLOR[m.key],
			share: totalTokens > 0 ? m.tokens / totalTokens : 0
		}));
}

/**
 * Actual spend against "list price": what the window would have cost with
 * neither cache layer, and the share of that the caches avoided.
 */
export function cacheSavings(b: CacheSavingsInput): {
	totalSaved: number;
	listCost: number;
	savedShare: number;
} {
	const totalSaved = b.savedUsd + b.providerCacheSavedUsd;
	const listCost = b.costUsd + totalSaved;
	return { totalSaved, listCost, savedShare: listCost > 0 ? totalSaved / listCost : 0 };
}
