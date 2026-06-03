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
 * gateway request. Rules, in order:
 *   1. token scopes — empty means "all scopes"
 *   2. token.allowedModels — empty means "no extra restriction"; when set it
 *      narrows the policy (the model must satisfy this list too)
 *   3. policy.allowedProviders — empty means "all providers"
 *   4. policy.allowedModels — empty means "all models", supports `*` suffix globs
 *
 * An empty `req.model` (e.g. the provider-only probe the /v1/models listing
 * makes) skips the model rules — there is no model to constrain.
 */
export function evaluatePolicy(token: ResolvedToken, req: PolicyRequest): PolicyResult {
	// 1. scope check
	if (token.scopes.length > 0 && !token.scopes.includes(req.scope)) {
		return { allow: false, reason: `token is not scoped for "${req.scope}"` };
	}

	// 2. per-token model allowlist — narrows whatever policy applies (intersection)
	if (
		req.model &&
		token.allowedModels.length > 0 &&
		!modelAllowed(token.allowedModels, req.model)
	) {
		return { allow: false, reason: `token forbids model "${req.model}"` };
	}

	const policy = token.policy;
	if (!policy) return { allow: true };

	// 3. provider check
	if (policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(req.provider)) {
		return { allow: false, reason: `policy forbids provider "${req.provider}"` };
	}

	// 4. model check (supports trailing "*" wildcard, e.g. "gpt-4o*")
	if (
		req.model &&
		policy.allowedModels.length > 0 &&
		!modelAllowed(policy.allowedModels, req.model)
	) {
		return { allow: false, reason: `policy forbids model "${req.model}"` };
	}

	return { allow: true };
}
