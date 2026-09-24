/**
 * Server entry point for the effective-config cascade. The cascade itself is
 * pure and lives in $lib/features/policies/effective-config so the forms can run
 * it in the browser; this module adds the DB-row typed resolver the gateway uses.
 */
import type { policy, service, machineToken } from '$lib/server/db/schema';
import {
	explainEffectiveConfig,
	type InstanceDefaults
} from '$lib/features/policies/effective-config';
import type { SourcedBudget } from '$lib/features/policies/effective-config-view';

export {
	explainEffectiveConfig,
	explainInherited,
	type ConfigLayerRow,
	type ExplainInput,
	type InstanceDefaults
} from '$lib/features/policies/effective-config';

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
	/** this token's personal spend cap (a budget of 0 in a field = unlimited). */
	tokenBudget: ResolvedBudget;
	/** the service-wide spend ceiling across all of its tokens. */
	serviceBudget: ResolvedBudget;
	/** the instance-wide ceiling across every service and token. */
	instanceBudget: ResolvedBudget;
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

const budgetValues = (b: SourcedBudget | null): ResolvedBudget => ({
	dailyBudgetUsd: b?.daily.value ?? 0,
	monthlyBudgetUsd: b?.monthly.value ?? 0
});

/**
 * Merge the five config layers into a single effective config for a request.
 * Pure and side-effect free — unit-tested in tests/unit/effective-config.test.ts.
 */
export function resolveEffectiveConfig(input: ResolveInput): EffectiveConfig {
	const e = explainEffectiveConfig(input);
	return {
		providerLists: e.providers.map((l) => l.values),
		modelLists: e.models.map((l) => l.values),
		preferredProvider: e.preferredProvider.value,
		rateLimitPerMinute: e.rateLimitPerMinute.value,
		cacheTtlSeconds: e.cacheTtlSeconds.value,
		// always present: the input carries a token
		tokenBudget: budgetValues(e.tokenBudget),
		serviceBudget: budgetValues(e.serviceBudget),
		instanceBudget: budgetValues(e.instanceBudget)
	};
}
