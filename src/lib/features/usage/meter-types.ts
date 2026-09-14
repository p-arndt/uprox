/**
 * Token meter shapes: what the meter query returns and the token-meter card
 * renders. Client-safe (types only), so components can import them without
 * reaching into `$lib/server`.
 */
import type { MeterKey } from '$lib/usage-meters';

/**
 * One consumption meter — uprox's answer to an Azure "meter", the sub-line a
 * resource's cost decomposes into. The vocabulary and the arithmetic live in
 * `$lib/usage-meters`; the server query only supplies the sums.
 */
export interface TokenMeter {
	key: MeterKey;
	tokens: number;
	/**
	 * Actual spend attributed to this meter. Derived by pricing each meter at its
	 * own list rate and then scaling so the meters sum to the spend actually
	 * recorded — an allocation, not an independent measurement, because the
	 * provider bills one number per request and never itemises it. Scaling is what
	 * keeps the meters reconciling with the headline instead of drifting whenever
	 * a price row is edited after the fact.
	 */
	costUsd: number;
}

export interface TokenMeterBreakdown {
	meters: TokenMeter[];
	/** every metered token in the window — the meters sum to exactly this */
	totalTokens: number;
	/** actual spend recorded for the window */
	costUsd: number;
	/** exact USD uprox's own response cache avoided (replayed requests) */
	savedUsd: number;
	/** input tokens uprox replayed from its response cache (never sent upstream) */
	savedInputTokens: number;
	savedOutputTokens: number;
	/**
	 * Estimated USD the *provider's* prompt cache avoided: cache-read tokens
	 * priced at the delta between full input and the cache-read rate, per model.
	 * An estimate, unlike savedUsd — the provider bills the discount, it doesn't
	 * itemise it — so it is always labelled as such in the UI.
	 */
	providerCacheSavedUsd: number;
}
