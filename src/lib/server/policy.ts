import type { ResolvedToken } from '$lib/server/tokens';

export interface PolicyRequest {
	provider: string;
	model: string;
	/** scope the request needs, e.g. "chat" | "responses" | "embeddings" | "models" */
	scope: string;
}

export type PolicyResult = { allow: true } | { allow: false; reason: string };

/**
 * Match a model name against an allowlist of patterns. A trailing "*" is a
 * prefix glob (e.g. "gpt-4o*"); everything else is an exact match. Comparison is
 * case-insensitive, consistent with model routing which lowercases.
 */
export function modelAllowed(patterns: string[], model: string): boolean {
	const m = model.toLowerCase();
	return patterns.some((pattern) => {
		const p = pattern.toLowerCase();
		if (p.endsWith('*')) return m.startsWith(p.slice(0, -1));
		return p === m;
	});
}

/**
 * The policy engine. Decides whether a resolved token may perform a given
 * gateway request against its effective config. Rules, in order:
 *   1. token scopes — empty means "all scopes"
 *   2. provider allowlists — the provider must appear in EVERY non-empty list
 *      contributed by the layers (token/preset/service/service-preset)
 *   3. model allowlists — same intersection, with trailing "*" prefix globs
 *
 * The allowlists are pre-merged into `effective.providerLists` / `modelLists`
 * (only the non-empty ones), so intersection is just "must satisfy all of them".
 * An empty `req.model` (e.g. the provider-only probe the /v1/models listing
 * makes) skips the model rules — there is no model to constrain.
 */
export function evaluatePolicy(token: ResolvedToken, req: PolicyRequest): PolicyResult {
	// 1. scope check
	if (token.scopes.length > 0 && !token.scopes.includes(req.scope)) {
		return { allow: false, reason: `token is not scoped for "${req.scope}"` };
	}

	// 2. provider intersection — must be allowed by every layer that restricts
	for (const list of token.effective.providerLists) {
		if (!list.includes(req.provider)) {
			return { allow: false, reason: `provider "${req.provider}" is not allowed` };
		}
	}

	// 3. model intersection (supports trailing "*" wildcard, e.g. "gpt-4o*")
	if (req.model) {
		for (const list of token.effective.modelLists) {
			if (!modelAllowed(list, req.model)) {
				return { allow: false, reason: `model "${req.model}" is not allowed` };
			}
		}
	}

	return { allow: true };
}
