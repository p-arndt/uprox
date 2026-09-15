/** Inline limit & access override columns shared by services and tokens. */

/**
 * Inline limit & access overrides settable directly on a service or token —
 * the higher-priority layers of the effective-config cascade (see
 * effective-config.ts). Every field is optional and nullable: omit to leave
 * unchanged, pass `null` to clear the override (revert to inherit).
 */
export interface InlineConfigInput {
	allowedProviders?: string[] | null;
	allowedModels?: string[] | null;
	preferredProvider?: string | null;
	rateLimitPerMinute?: number | null;
	dailyBudgetUsd?: number | null;
	monthlyBudgetUsd?: number | null;
	cacheTtlSeconds?: number | null;
}

/**
 * Map the inline-config fields present in `input` to a drizzle set/values object,
 * coercing the numeric budget columns to the string form drizzle/pg expects.
 * Only keys actually present are written, so it composes with PATCH semantics.
 */
export function inlineConfigColumns(input: InlineConfigInput): Record<string, unknown> {
	const set: Record<string, unknown> = {};
	if (input.allowedProviders !== undefined) set.allowedProviders = input.allowedProviders;
	if (input.allowedModels !== undefined) set.allowedModels = input.allowedModels;
	if (input.preferredProvider !== undefined) set.preferredProvider = input.preferredProvider;
	if (input.rateLimitPerMinute !== undefined) set.rateLimitPerMinute = input.rateLimitPerMinute;
	if (input.dailyBudgetUsd !== undefined) {
		set.dailyBudgetUsd = input.dailyBudgetUsd === null ? null : String(input.dailyBudgetUsd);
	}
	if (input.monthlyBudgetUsd !== undefined) {
		set.monthlyBudgetUsd = input.monthlyBudgetUsd === null ? null : String(input.monthlyBudgetUsd);
	}
	if (input.cacheTtlSeconds !== undefined) set.cacheTtlSeconds = input.cacheTtlSeconds;
	return set;
}
