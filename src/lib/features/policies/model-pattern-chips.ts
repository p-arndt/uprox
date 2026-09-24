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

/**
 * The suggestions to list under the input: known ids not yet chosen, matching
 * the draft anywhere (people type "sonnet", not "claude-sonnet"), ids starting
 * with the draft first, capped so the list stays scannable.
 */
export function matchSuggestions(
	suggestions: readonly string[],
	chips: readonly string[],
	draft: string,
	limit = 8
): string[] {
	const taken = new Set(chips.map((c) => c.toLowerCase()));
	const q = draft.trim().toLowerCase();
	const open = suggestions.filter((s) => !taken.has(s.toLowerCase()));
	if (!q) return open.slice(0, limit);
	const starts = open.filter((s) => s.toLowerCase().startsWith(q));
	const contains = open.filter(
		(s) => !s.toLowerCase().startsWith(q) && s.toLowerCase().includes(q)
	);
	return [...starts, ...contains].slice(0, limit);
}
