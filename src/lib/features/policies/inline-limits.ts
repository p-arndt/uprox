/**
 * Shared form values for the inline limits & access fields, used by both the
 * token form and the service form. Every field maps to one inline override
 * column; blank means "inherit" (the cascade falls through to the preset / the
 * service / the instance default). See effective-config.ts for the resolution.
 */
export interface InlineLimitValues {
	/** allowed provider ids; empty = no extra restriction from this layer */
	allowedProviders: string[];
	/** comma-joined model patterns; blank = no extra restriction */
	allowedModels: string;
	/** preferred OpenAI backend; '' = inherit */
	preferredProvider: string;
	/** requests/min; '' = inherit, 0 = unlimited */
	rateLimitPerMinute: string;
	/** USD; '' = inherit, 0 = unlimited */
	dailyBudgetUsd: string;
	/** USD; '' = inherit, 0 = unlimited */
	monthlyBudgetUsd: string;
	/** seconds; '' = inherit, 0 = off */
	cacheTtlSeconds: string;
	/** '' = inherit | 'true' = on | 'false' = off */
	tracingEnabled: string;
}

/** Empty/default inline values (everything inherits). */
export const emptyInlineLimits = (): InlineLimitValues => ({
	allowedProviders: [],
	allowedModels: '',
	preferredProvider: '',
	rateLimitPerMinute: '',
	dailyBudgetUsd: '',
	monthlyBudgetUsd: '',
	cacheTtlSeconds: '',
	tracingEnabled: ''
});

/** The inline override columns as they come back on a service/token/preset row. */
export interface InlineLimitRow {
	allowedProviders?: string[] | null;
	allowedModels?: string[] | null;
	preferredProvider?: string | null;
	rateLimitPerMinute?: number | null;
	/** numeric columns round-trip as strings */
	dailyBudgetUsd?: number | string | null;
	monthlyBudgetUsd?: number | string | null;
	cacheTtlSeconds?: number | null;
	tracingEnabled?: boolean | null;
}

/** A null column becomes '' (inherit); numeric strings are normalized for display. */
const numStr = (v: number | string | null | undefined) => (v == null ? '' : String(Number(v)));

/** Map a row's inline override columns to form values for editing. */
export function inlineLimitsFromRow(row: InlineLimitRow): InlineLimitValues {
	return {
		allowedProviders: [...(row.allowedProviders ?? [])],
		allowedModels: (row.allowedModels ?? []).join(', '),
		preferredProvider: row.preferredProvider ?? '',
		rateLimitPerMinute: row.rateLimitPerMinute == null ? '' : String(row.rateLimitPerMinute),
		dailyBudgetUsd: numStr(row.dailyBudgetUsd),
		monthlyBudgetUsd: numStr(row.monthlyBudgetUsd),
		cacheTtlSeconds: row.cacheTtlSeconds == null ? '' : String(row.cacheTtlSeconds),
		tracingEnabled: row.tracingEnabled == null ? '' : String(row.tracingEnabled)
	};
}
