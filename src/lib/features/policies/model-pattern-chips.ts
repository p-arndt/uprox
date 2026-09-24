/** List handling behind the model pattern chip input. */

/** Split comma-separated patterns into a trimmed list without blanks. */
export function splitModelPatterns(raw: string): string[] {
	return raw
		.split(',')
		.map((m) => m.trim())
		.filter(Boolean);
}

/**
 * Append the patterns in `raw` (possibly several, comma-separated) to `chips`,
 * skipping ones already present. Model routing is case-insensitive, so
 * "GPT-4o" duplicates "gpt-4o".
 */
export function addModelPatterns(chips: string[], raw: string): string[] {
	const out = [...chips];
	const seen = new Set(out.map((c) => c.toLowerCase()));
	for (const p of splitModelPatterns(raw)) {
		if (seen.has(p.toLowerCase())) continue;
		seen.add(p.toLowerCase());
		out.push(p);
	}
	return out;
}
