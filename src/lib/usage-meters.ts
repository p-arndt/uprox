/**
 * The billing-meter vocabulary and the arithmetic that turns a group of raw
 * token sums into it.
 *
 * A gateway request doesn't bill as one undifferentiated blob of tokens: fresh
 * input, cache reads, cache writes, output and embeddings are each metered at a
 * different rate (the `*_per_mtok` columns on `model_price`). Three views need
 * that same decomposition — the token-meter card, the meter time series, and the
 * per-model billing-line breakdown — so the partition and the list-price costing
 * live here once, as pure functions, rather than being re-derived (and drifting)
 * at each call site.
 *
 * Client-safe and DB-free by construction: callers hand in numbers they already
 * summed in SQL. That's also what makes the arithmetic unit-testable, which
 * matters more here than anywhere else on the usage page — these are the figures
 * an operator reconciles an invoice against.
 */

export type MeterKey = 'input' | 'cacheRead' | 'cacheWrite' | 'output' | 'embedding';

/** Display order — the order the composition bar stacks and the chart bands sit in. */
export const METER_ORDER: readonly MeterKey[] = [
	'input',
	'cacheRead',
	'cacheWrite',
	'output',
	'embedding'
];

/**
 * One group's token sums, with the embedding subset already separated out by the
 * query (embeddings are never prompt-cached, and they're metered as their own
 * line, so they can't be left mixed into input/output).
 */
export interface MeterTokenSums {
	/** non-embedding prompt tokens as billed upstream — cache read/write included */
	inputTokens: number;
	/** non-embedding completion tokens */
	outputTokens: number;
	/** the subset of `inputTokens` the provider served from its prompt cache */
	cacheReadTokens: number;
	/** the subset of `inputTokens` written to the provider's prompt cache */
	cacheWriteTokens: number;
	embeddingInputTokens: number;
	embeddingOutputTokens: number;
}

/** A value per meter — tokens in one context, USD in another. */
export type MeterValues = Record<MeterKey, number>;

export function emptyMeterValues(): MeterValues {
	return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, embedding: 0 };
}

/**
 * Partition a group's tokens across the meters.
 *
 * The meters sum to exactly the group's total token volume — every token lands
 * in exactly one meter — because a breakdown whose parts don't add up to the
 * whole is worse than no breakdown. Cache reads and writes are *subsets* of the
 * prompt, so fresh input is what's left after carving them out: the same
 * subtraction the gateway's own cost formula performs, which is why the meters
 * partition the volume the way the bill does.
 *
 * Clamped at zero: the counts come from upstream usage blocks independently of
 * each other, so a malformed one could otherwise drive a meter negative.
 */
export function splitMeters(r: MeterTokenSums): MeterValues {
	return {
		input: Math.max(0, r.inputTokens - r.cacheReadTokens - r.cacheWriteTokens),
		cacheRead: Math.max(0, r.cacheReadTokens),
		cacheWrite: Math.max(0, r.cacheWriteTokens),
		output: Math.max(0, r.outputTokens),
		embedding: Math.max(0, r.embeddingInputTokens) + Math.max(0, r.embeddingOutputTokens)
	};
}

/** The rate-card slice the meter costing needs, for one model at one context tier. */
export interface MeterRates {
	inputPerMtok: number;
	outputPerMtok: number;
	/** NULL = the provider doesn't publish one; the fallback multiplier applies */
	cacheReadPerMtok: number | null;
	cacheWritePerMtok: number | null;
}

/**
 * Fallback multipliers for a rate card that leaves the cache rates NULL. These
 * match the gateway's own fallbacks, so a meter split can never price a request
 * differently from the way it was actually charged.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

export function cacheReadRate(p: MeterRates): number {
	return p.cacheReadPerMtok ?? p.inputPerMtok * CACHE_READ_MULTIPLIER;
}

export function cacheWriteRate(p: MeterRates): number {
	return p.cacheWritePerMtok ?? p.inputPerMtok * CACHE_WRITE_MULTIPLIER;
}

const PER_MTOK = 1_000_000;

/**
 * List-price cost per meter for one group, at that group's rate card.
 *
 * "List price" because it deliberately ignores the spend actually recorded: the
 * caller rescales these onto the real `cost_usd` sum so the parts reconcile with
 * the headline (see the `scale` factor at each call site). Pricing here and
 * scaling there is what keeps the split stable when a price row is edited after
 * the fact — the totals stay the ones the gateway charged, only the attribution
 * moves.
 *
 * A group with no matching price row costs nothing at list price, which drops it
 * out of the scaling entirely rather than letting an unpriced model claim a
 * share of someone else's spend.
 */
export function meterListCosts(r: MeterTokenSums, p: MeterRates | null): MeterValues {
	if (!p) return emptyMeterValues();
	const t = splitMeters(r);
	return {
		input: (t.input * p.inputPerMtok) / PER_MTOK,
		cacheRead: (t.cacheRead * cacheReadRate(p)) / PER_MTOK,
		cacheWrite: (t.cacheWrite * cacheWriteRate(p)) / PER_MTOK,
		output: (t.output * p.outputPerMtok) / PER_MTOK,
		// Embeddings are metered as one line but their prompt and (rare) completion
		// halves bill at different rates, so the line's cost is the blend. The
		// effective $/Mtok the UI shows is recovered from cost ÷ tokens, which is
		// exactly the input rate whenever the completion half is empty.
		embedding:
			(Math.max(0, r.embeddingInputTokens) * p.inputPerMtok +
				Math.max(0, r.embeddingOutputTokens) * p.outputPerMtok) /
			PER_MTOK
	};
}

/**
 * What the provider's prompt cache avoided for one group: the cache-read tokens
 * priced at the gap between the full input rate and the cache-read rate.
 *
 * An estimate, unlike uprox's own `saved_usd` — the provider bills the discount
 * without ever itemising it — so every surface that shows this figure labels it
 * as one.
 */
export function providerCacheSaving(r: MeterTokenSums, p: MeterRates | null): number {
	if (!p) return 0;
	const read = Math.max(0, r.cacheReadTokens);
	if (read <= 0) return 0;
	return (read * Math.max(0, p.inputPerMtok - cacheReadRate(p))) / PER_MTOK;
}

/**
 * Map a list-price split onto the spend actually recorded, so the meters sum to
 * the real figure instead of drifting from it.
 *
 * Three cases, in order:
 *  - Priced traffic: scale the list split by `actual / list`. The attribution
 *    follows the rate card, the total stays the one the gateway charged.
 *  - Spend with no rate card behind it (an unpriced model whose cost came from
 *    an upstream-reported figure): fall back to splitting by token share. Crude
 *    - it prices a cache read like fresh input - but it keeps the breakdown
 *    reconciling with the headline, and silently dropping real spend out of the
 *    table would be the worse lie.
 *  - No spend at all: zeroes, rather than inventing an attribution.
 */
export function allocateCost(
	list: MeterValues,
	tokens: MeterValues,
	actualCost: number
): MeterValues {
	const listTotal = sumMeterValues(list);
	if (actualCost <= 0) return emptyMeterValues();
	if (listTotal > 0) {
		const scale = actualCost / listTotal;
		return scaleMeterValues(list, scale);
	}
	const tokenTotal = sumMeterValues(tokens);
	if (tokenTotal <= 0) return emptyMeterValues();
	return scaleMeterValues(tokens, actualCost / tokenTotal);
}

function scaleMeterValues(v: MeterValues, factor: number): MeterValues {
	return {
		input: v.input * factor,
		cacheRead: v.cacheRead * factor,
		cacheWrite: v.cacheWrite * factor,
		output: v.output * factor,
		embedding: v.embedding * factor
	};
}

export function addMeterValues(into: MeterValues, from: MeterValues): void {
	for (const k of METER_ORDER) into[k] += from[k];
}

export function sumMeterValues(v: MeterValues): number {
	return METER_ORDER.reduce((a, k) => a + v[k], 0);
}

/**
 * The effective unit price of a meter line: what the operator is really paying
 * per million tokens once the reconciliation above has been applied.
 *
 * Derived rather than read off the rate card on purpose. For a pure meter it
 * *is* the card rate, which makes it checkable against the pricing page; where
 * it isn't — a blended embedding line, or a model whose recorded spend doesn't
 * match its current price row — the derived figure is the true one, and the
 * discrepancy is worth seeing rather than papering over.
 */
export function effectiveRatePerMtok(costUsd: number, tokens: number): number | null {
	return tokens > 0 ? (costUsd / tokens) * PER_MTOK : null;
}
