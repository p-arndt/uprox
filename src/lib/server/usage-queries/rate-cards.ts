/** Model price lookup for the meter allocations. */
import { db } from '$lib/server/db';
import { modelPrice } from '$lib/server/db/schema';
import type { MeterRates } from '$lib/usage-meters';

/**
 * A model's rate card: the standard rates, plus the long-context card when the
 * model publishes one.
 *
 * Both are carried because a billing line names the tier it billed against, and
 * pricing a long-context line at the standard rate would make the one thing the
 * grouping exists to expose — that crossing the threshold reprices every token —
 * disappear from the numbers.
 */
export interface ResolvedPrice {
	model: string;
	standard: MeterRates;
	/** null when the model has a single rate card for every prompt size */
	long: MeterRates | null;
}

/**
 * All price rows, instance overrides shadowing the platform defaults for the
 * same model. Read once per meter query rather than joined per row — the table
 * is small (hundreds of rows at most) and this keeps the aggregate query simple.
 */
export async function listModelPrices(): Promise<ResolvedPrice[]> {
	const rows = await db
		.select({
			model: modelPrice.model,
			isDefault: modelPrice.isDefault,
			inputPerMtok: modelPrice.inputPerMtok,
			outputPerMtok: modelPrice.outputPerMtok,
			cacheReadPerMtok: modelPrice.cacheReadPerMtok,
			cacheWritePerMtok: modelPrice.cacheWritePerMtok,
			longInputPerMtok: modelPrice.longInputPerMtok,
			longOutputPerMtok: modelPrice.longOutputPerMtok,
			longCacheReadPerMtok: modelPrice.longCacheReadPerMtok,
			longCacheWritePerMtok: modelPrice.longCacheWritePerMtok
		})
		.from(modelPrice);

	const num = (v: string | null) => (v == null ? null : Number(v));
	const byModel = new Map<string, ResolvedPrice>();
	// custom rows win, so apply defaults first and let overrides replace them
	for (const r of [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))) {
		const standard: MeterRates = {
			inputPerMtok: Number(r.inputPerMtok ?? 0),
			outputPerMtok: Number(r.outputPerMtok ?? 0),
			cacheReadPerMtok: num(r.cacheReadPerMtok),
			cacheWritePerMtok: num(r.cacheWritePerMtok)
		};
		// A NULL long input rate means the model has one rate card for every prompt
		// size (see the schema note); the remaining long columns then fall back to
		// their standard counterparts rather than to zero.
		const longInput = num(r.longInputPerMtok);
		byModel.set(r.model.toLowerCase(), {
			model: r.model.toLowerCase(),
			standard,
			long:
				longInput == null
					? null
					: {
							inputPerMtok: longInput,
							outputPerMtok: num(r.longOutputPerMtok) ?? standard.outputPerMtok,
							cacheReadPerMtok: num(r.longCacheReadPerMtok),
							cacheWritePerMtok: num(r.longCacheWritePerMtok)
						}
		});
	}
	return [...byModel.values()];
}

/** Longest-prefix match, mirroring how the gateway prices a request. */
export function resolveModelPrice(prices: ResolvedPrice[], model: string): ResolvedPrice | null {
	const key = model.toLowerCase();
	let best: ResolvedPrice | null = null;
	for (const p of prices) {
		if (key === p.model) return p;
		if (key.startsWith(p.model) && (!best || p.model.length > best.model.length)) best = p;
	}
	return best;
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
	prices: ResolvedPrice[],
	model: string | null,
	tier: string | null
): MeterRates | null {
	if (!model) return null;
	const p = resolveModelPrice(prices, model);
	if (!p) return null;
	return tier === 'long' ? (p.long ?? p.standard) : p.standard;
}
