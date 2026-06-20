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
