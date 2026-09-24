/**
 * Validation for model allowlist patterns ("gpt-4o*", "claude-sonnet-4-6").
 * Pure, so the forms can flag a pattern while it is typed and the server can
 * enforce the same rule on submit.
 *
 * The matcher (modelAllowed in server/policy.ts) only understands a trailing
 * "*" as a prefix glob; a "*" anywhere else would be compared literally and
 * silently never match, so it is rejected instead.
 */

/** The error for a malformed pattern, or null when it is valid. */
export function modelPatternError(pattern: string): string | null {
	const star = pattern.indexOf('*');
	if (star !== -1 && star !== pattern.length - 1) {
		return `“${pattern}”: * is only allowed at the end (prefix match)`;
	}
	if (/\s/.test(pattern)) return `“${pattern}”: model patterns cannot contain spaces`;
	return null;
}

/** The first error across a list of patterns, or null when all are valid. */
export function modelPatternsError(patterns: string[]): string | null {
	for (const p of patterns) {
		const err = modelPatternError(p);
		if (err) return err;
	}
	return null;
}

/**
 * Whether a pattern could match any known model id. Known ids are price-list
 * keys, which are themselves prefixes (a dated snapshot like
 * "gpt-5.4-mini-2026-01-01" bills as "gpt-5.4-mini"), so a pattern also counts
 * as known when a known id is a dash-delimited prefix of it.
 */
export function patternMatchesKnown(pattern: string, known: readonly string[]): boolean {
	const p = pattern.toLowerCase();
	const isGlob = p.endsWith('*');
	const stem = isGlob ? p.slice(0, -1) : p;
	return known.some((raw) => {
		const k = raw.toLowerCase();
		if (k === stem) return true;
		if (isGlob && k.startsWith(stem)) return true;
		return stem.startsWith(`${k}-`);
	});
}

/** The patterns that match no known model (a hint for typos, not an error). */
export function unknownModelPatterns(patterns: string[], known: readonly string[]): string[] {
	if (known.length === 0) return [];
	return patterns.filter((p) => !patternMatchesKnown(p, known));
}
