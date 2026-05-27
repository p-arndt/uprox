import type { ResolvedToken } from '$lib/server/tokens';

export interface PolicyRequest {
	provider: string;
	model: string;
	/** scope the request needs, e.g. "chat" | "responses" | "embeddings" | "models" */
	scope: string;
}

export type PolicyResult = { allow: true } | { allow: false; reason: string };

/**
 * The policy engine. Decides whether a resolved token may perform a given
 * gateway request. Rules, in order:
 *   1. token scopes — empty means "all scopes"
 *   2. policy.allowedProviders — empty means "all providers"
 *   3. policy.allowedModels — empty means "all models", supports `*` suffix globs
 */
export function evaluatePolicy(token: ResolvedToken, req: PolicyRequest): PolicyResult {
	// 1. scope check
	if (token.scopes.length > 0 && !token.scopes.includes(req.scope)) {
		return { allow: false, reason: `token is not scoped for "${req.scope}"` };
	}

	const policy = token.policy;
	if (!policy) return { allow: true };

	// 2. provider check
	if (policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(req.provider)) {
		return { allow: false, reason: `policy forbids provider "${req.provider}"` };
	}

	// 3. model check (supports trailing "*" wildcard, e.g. "gpt-4o*")
	//    matched case-insensitively, consistent with model routing which lowercases.
	if (policy.allowedModels.length > 0) {
		const model = req.model.toLowerCase();
		const ok = policy.allowedModels.some((pattern) => {
			const p = pattern.toLowerCase();
			if (p.endsWith('*')) return model.startsWith(p.slice(0, -1));
			return p === model;
		});
		if (!ok) return { allow: false, reason: `policy forbids model "${req.model}"` };
	}

	return { allow: true };
}
