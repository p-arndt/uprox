/** Form parsing for the preset create/update actions. */
import { inlineFromForm } from '$lib/server/parse-config';
import { modelPatternsError, unknownModelPatterns } from '$lib/model-patterns';

export type ParsedPolicyForm =
	| { ok: false; message: string }
	| {
			ok: true;
			name: string;
			fields: ReturnType<typeof policyFields>;
			/** patterns that match no known model; saved anyway, surfaced as a warning */
			unknownModels: string[];
	  };

/**
 * A preset's fields from the shared limits form. Unlike the inline overrides on
 * services and tokens, a preset's lists, rate limit and budgets are always set:
 * blank means "allow all" / unlimited (0). The cache TTL keeps the tri-state,
 * where blank inherits the instance default.
 */
function policyFields(data: FormData) {
	const inline = inlineFromForm(data, { includeModels: true });
	return {
		allowedProviders: inline.allowedProviders ?? [],
		allowedModels: inline.allowedModels ?? [],
		preferredProvider: inline.preferredProvider ?? null,
		rateLimitPerMinute: Math.trunc(inline.rateLimitPerMinute ?? 0),
		dailyBudgetUsd: inline.dailyBudgetUsd ?? 0,
		monthlyBudgetUsd: inline.monthlyBudgetUsd ?? 0,
		cacheTtlSeconds: inline.cacheTtlSeconds == null ? null : Math.trunc(inline.cacheTtlSeconds)
	};
}

/** Validate a submitted preset form against the instance's known model ids. */
export function parsePolicyForm(data: FormData, knownModels: readonly string[]): ParsedPolicyForm {
	const name = data.get('name')?.toString().trim();
	if (!name) return { ok: false, message: 'Name is required' };
	const fields = policyFields(data);
	const patternError = modelPatternsError(fields.allowedModels);
	if (patternError) return { ok: false, message: patternError };
	return {
		ok: true,
		name,
		fields,
		unknownModels: unknownModelPatterns(fields.allowedModels, knownModels)
	};
}

/** The non-blocking note for patterns no known model matches, or undefined. */
export function unknownModelsWarning(unknown: string[]): string | undefined {
	if (unknown.length === 0) return undefined;
	const list = unknown.map((m) => `“${m}”`).join(', ');
	return `Saved, but no known model matches ${list}. Check for typos.`;
}
