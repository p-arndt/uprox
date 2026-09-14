/**
 * Cheapest and dearest unit price across models, so the extremes are findable
 * at a glance. Only meaningful with something to compare: both are null unless
 * at least two models have a positive price.
 */
export function priceExtremes(rows: { costPer1kTokens: number }[]): {
	cheapest: number | null;
	dearest: number | null;
} {
	const prices = rows.map((r) => r.costPer1kTokens).filter((p) => p > 0);
	if (prices.length < 2) return { cheapest: null, dearest: null };
	return { cheapest: Math.min(...prices), dearest: Math.max(...prices) };
}

/** Which extreme a price is, for highlighting its cell. */
export function priceExtreme(
	price: number,
	extremes: { cheapest: number | null; dearest: number | null }
): 'cheapest' | 'dearest' | null {
	if (price <= 0) return null;
	if (price === extremes.cheapest) return 'cheapest';
	if (price === extremes.dearest) return 'dearest';
	return null;
}
