/**
 * Series colours for the grouped usage charts.
 *
 * These are the `--series-*` tokens from layout.css, not the `--chart-*` ramp.
 * The chart ramp is a monochrome violet scale — correct when colour encodes
 * *magnitude* for one series, wrong the moment colour has to encode *identity*
 * across a stack, where five shades of the same hue are indistinguishable.
 *
 * ## Why assignment is by rank, not by entity
 *
 * The palette's slot order is what makes it colourblind-safe: it was validated
 * pairwise on *adjacent* slots (1↔2, 2↔3, …), which is the pairing that matters
 * for stacked bars, grouped bars and lines. Only the first three slots survive
 * an all-pairs check, so any scheme that scatters entities across arbitrary
 * slots (a hash, say) would put unvalidated pairs side by side in a stack.
 *
 * So slots are handed out in stack order: the largest series takes slot 1, the
 * next takes slot 2, and adjacent stack segments are therefore always an
 * adjacent, validated pair. The cost is that a series can change colour when
 * the ranking changes (a filter, a different window). The legend and the detail
 * table carry the labels, so identity is never colour-alone — and in light mode
 * three slots sit under 3:1 against the card, which makes those text labels
 * required rather than merely nice.
 */

/** CSS colour expressions for the eight categorical slots, in validated order. */
const SERIES_VARS = [
	'var(--series-1)',
	'var(--series-2)',
	'var(--series-3)',
	'var(--series-4)',
	'var(--series-5)',
	'var(--series-6)',
	'var(--series-7)',
	'var(--series-8)'
] as const;

/** How many real series get their own colour before the rest fold into "Others". */
export const MAX_SERIES = SERIES_VARS.length;

/** The neutral used for the "Others" aggregate and for any overflow rank. */
export const OTHERS_COLOR = 'var(--series-other)';

/**
 * Colour for the series at `rank` (0-based, largest first). Ranks past the
 * palette collapse to the neutral rather than cycling — a recycled hue would
 * claim two different entities share an identity, which is the one thing a
 * categorical palette must never say.
 */
export function seriesColor(rank: number): string {
	return SERIES_VARS[rank] ?? OTHERS_COLOR;
}

/**
 * Status colours for the request-outcome dimension. Held apart from the
 * categorical slots on purpose: green/red here mean "good/bad", and reusing a
 * series hue for that (or vice versa) would let a colour quietly change meaning
 * between two charts on the same page. Always paired with the status text.
 */
export const STATUS_COLORS: Record<string, string> = {
	allow: '#0ca30c',
	ok: '#0ca30c',
	deny: '#fab219',
	error: '#d03b3b'
};

/**
 * Colour for one series of a given dimension: the status dimension gets the
 * fixed semantic palette, everything else gets its rank's categorical slot.
 */
export function colorForSeries(dim: string, key: string, rank: number): string {
	if (dim === 'status') return STATUS_COLORS[key] ?? OTHERS_COLOR;
	// Meters are a fixed vocabulary, so they keep fixed colours — the band in the
	// over-time chart must match the swatch in the composition bar above it.
	if (dim === 'meter') return METER_COLOR[key] ?? OTHERS_COLOR;
	return seriesColor(rank);
}

/**
 * Token meters get FIXED colours, not rank-assigned ones. A meter is a stable
 * concept — "cache read" means the same thing in every window — so its colour
 * has to stay put even as the volumes reorder, unlike a service ranking where
 * position is the whole point. Slots are drawn from the same validated palette
 * in adjacent order, so the composition bar keeps its colourblind separation.
 */
export const METER_COLOR: Record<string, string> = {
	input: 'var(--series-1)',
	cacheRead: 'var(--series-3)',
	cacheWrite: 'var(--series-4)',
	output: 'var(--series-2)',
	embedding: 'var(--series-7)'
};

/** Display copy for each meter — the label and why it's billed differently. */
export const METER_META: Record<string, { label: string; hint: string }> = {
	input: {
		label: 'Input (fresh)',
		hint: 'sent upstream and billed at the full input rate'
	},
	cacheRead: {
		label: 'Input (cache read)',
		hint: "served from the provider's prompt cache, typically ~10% of input"
	},
	cacheWrite: {
		label: 'Input (cache write)',
		hint: 'written to the prompt cache; some providers surcharge ~25%'
	},
	output: {
		label: 'Output',
		hint: 'generated tokens, the most expensive meter'
	},
	embedding: {
		label: 'Embeddings',
		hint: 'high volume, very low rate, never prompt-cached'
	}
};
