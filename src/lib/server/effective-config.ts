/**
 * The effective-config cascade. A request's limits and access come from up to
 * five layers, merged field-by-field so you can set a single limit anywhere
 * without duplicating everything else. Priority, most specific first:
 *
 *   token inline  →  token preset  →  service inline  →  service preset  →  default
 *
 * Two field kinds behave differently:
 *
 *   • Scalar OVERRIDE (rate limit, cache TTL, tracing, preferred provider):
 *     the first layer that sets a value wins; lower layers are ignored.
 *
 *   • Allowlist INTERSECTION (providers, models): every layer that sets a
 *     non-empty allowlist restricts further — a value must satisfy ALL of them.
 *     This keeps the long-standing "a token can only narrow, never widen"
 *     guarantee and extends it to services and presets.
 *
 * Budgets are the exception to the cascade: the token cap, the service-wide
 * ceiling, and the instance-wide ceiling are different aggregation scopes (one
 * token vs all of a service's tokens vs all traffic), so all three are resolved
 * and all three are enforced — a request must stay within each that is set; see
 * resolveBudget / the gateway. The token and service budgets cascade only within
 * their own scope (inline → preset); the instance budget is a single value from
 * the settings singleton, carried straight through.
 */
import type { policy, service, machineToken } from '$lib/server/db/schema';

type PolicyRow = typeof policy.$inferSelect;
type ServiceRow = typeof service.$inferSelect;
type TokenRow = typeof machineToken.$inferSelect;

export interface ResolvedBudget {
	dailyBudgetUsd: number;
	monthlyBudgetUsd: number;
}

export interface EffectiveConfig {
	/**
	 * Every non-empty provider allowlist across the layers. A request's provider
	 * must appear in ALL of them (intersection). Empty array = no restriction.
	 */
	providerLists: string[][];
	/** Same intersection semantics for model patterns (trailing "*" prefix glob). */
	modelLists: string[][];
	/** Preferred backend for shared model namespaces (OpenAI vs Azure), or null. */
	preferredProvider: string | null;
	/** requests/min; 0 = unlimited. */
	rateLimitPerMinute: number;
	/** resolved cache TTL in seconds (already merged with the instance default). */
	cacheTtlSeconds: number;
	/** resolved tracing flag (already merged with the instance default). */
	tracingEnabled: boolean;
	/** this token's personal spend cap (a budget of 0 in a field = unlimited). */
	tokenBudget: ResolvedBudget;
	/** the service-wide spend ceiling across all of its tokens. */
	serviceBudget: ResolvedBudget;
	/** the instance-wide ceiling across every service and token. */
	instanceBudget: ResolvedBudget;
}

export interface InstanceDefaults {
	cacheTtlSeconds: number;
	tracingEnabled: boolean;
	/** instance-wide spend ceilings (0 = unlimited); summed across all traffic. */
	dailyBudgetUsd: number;
	monthlyBudgetUsd: number;
}

/** First defined (non-null/undefined) value in priority order, or undefined. */
function firstDefined<T>(...values: (T | null | undefined)[]): T | undefined {
	for (const v of values) if (v !== null && v !== undefined) return v;
	return undefined;
}

/** Coerce a possibly-string numeric column to a number, treating null as unset. */
function num(v: string | number | null | undefined): number | undefined {
	if (v === null || v === undefined) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

/** Non-empty allowlists from the given layers, in cascade order (for display only). */
function allowlists(...lists: (string[] | null | undefined)[]): string[][] {
	return lists.filter((l): l is string[] => Array.isArray(l) && l.length > 0);
}

/** Resolve one budget scope: inline value first, then its preset, default 0. */
function resolveBudget(
	inline: { dailyBudgetUsd: string | null; monthlyBudgetUsd: string | null },
	preset: PolicyRow | null | undefined
): ResolvedBudget {
	return {
		dailyBudgetUsd: num(firstDefined(inline.dailyBudgetUsd, preset?.dailyBudgetUsd)) ?? 0,
		monthlyBudgetUsd: num(firstDefined(inline.monthlyBudgetUsd, preset?.monthlyBudgetUsd)) ?? 0
	};
}

export interface ResolveInput {
	token: TokenRow;
	service: ServiceRow;
	/** the token's own preset (machineToken.policyId), if any */
	tokenPolicy: PolicyRow | null;
	/** the service's preset (service.policyId), if any */
	servicePolicy: PolicyRow | null;
	defaults: InstanceDefaults;
}

/**
 * Merge the five config layers into a single effective config for a request.
 * Pure and side-effect free — unit-tested in tests/unit/effective-config.test.ts.
 */
export function resolveEffectiveConfig(input: ResolveInput): EffectiveConfig {
	const { token, service, tokenPolicy, servicePolicy, defaults } = input;

	return {
		// intersection layers, most specific first (order is cosmetic — all apply)
		providerLists: allowlists(
			token.allowedProviders,
			tokenPolicy?.allowedProviders,
			service.allowedProviders,
			servicePolicy?.allowedProviders
		),
		modelLists: allowlists(
			token.allowedModels,
			tokenPolicy?.allowedModels,
			service.allowedModels,
			servicePolicy?.allowedModels
		),
		preferredProvider:
			firstDefined(
				token.preferredProvider,
				tokenPolicy?.preferredProvider,
				service.preferredProvider,
				servicePolicy?.preferredProvider
			) ?? null,
		rateLimitPerMinute:
			num(
				firstDefined(
					token.rateLimitPerMinute,
					tokenPolicy?.rateLimitPerMinute,
					service.rateLimitPerMinute,
					servicePolicy?.rateLimitPerMinute
				)
			) ?? 0,
		cacheTtlSeconds:
			num(
				firstDefined(
					token.cacheTtlSeconds,
					tokenPolicy?.cacheTtlSeconds,
					service.cacheTtlSeconds,
					servicePolicy?.cacheTtlSeconds
				)
			) ?? defaults.cacheTtlSeconds,
		tracingEnabled:
			firstDefined(
				token.tracingEnabled,
				tokenPolicy?.tracingEnabled,
				service.tracingEnabled,
				servicePolicy?.tracingEnabled
			) ?? defaults.tracingEnabled,
		tokenBudget: resolveBudget(token, tokenPolicy),
		serviceBudget: resolveBudget(service, servicePolicy),
		// not a cascade — a single instance-wide value carried straight through
		instanceBudget: {
			dailyBudgetUsd: defaults.dailyBudgetUsd,
			monthlyBudgetUsd: defaults.monthlyBudgetUsd
		}
	};
}
