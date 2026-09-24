/**
 * The effective-config cascade. A request's limits and access come from up to
 * five layers, merged field-by-field so you can set a single limit anywhere
 * without duplicating everything else. Priority, most specific first:
 *
 *   token inline  →  token preset  →  service inline  →  service preset  →  default
 *
 * Two field kinds behave differently:
 *
 *   • Scalar OVERRIDE (rate limit, cache TTL, preferred provider):
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
 *
 * explainEffectiveConfig is the one implementation; it also records which layer
 * supplied each value so the UI can show where a limit comes from.
 */
import type { policy, service, machineToken } from '$lib/server/db/schema';
import type {
	ConfigSource,
	ExplainedConfig,
	Sourced,
	SourcedBudget,
	SourcedList
} from '$lib/features/policies/effective-config-view';

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

export interface InstanceDefaults {
	cacheTtlSeconds: number;
	/** instance-wide spend ceilings (0 = unlimited); summed across all traffic. */
	dailyBudgetUsd: number;
	monthlyBudgetUsd: number;
}

/** Coerce a possibly-string numeric column to a number, treating null as unset. */
function num(v: string | number | null | undefined): number | undefined {
	if (v === null || v === undefined) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * The config columns every layer shares. Structural so a caller can pass a
 * partial select; `name` feeds the provenance labels.
 */
export interface ConfigLayerRow {
	name?: string | null;
	allowedProviders: string[] | null;
	allowedModels: string[] | null;
	preferredProvider: string | null;
	rateLimitPerMinute: number | null;
	dailyBudgetUsd: string | null;
	monthlyBudgetUsd: string | null;
	cacheTtlSeconds: number | null;
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
 * Input for {@link explainEffectiveConfig}. Without a token it explains a
 * service on its own (service inline → service preset → instance default).
 */
export interface ExplainInput {
	token?: ConfigLayerRow | null;
	tokenPolicy?: ConfigLayerRow | null;
	service: ConfigLayerRow;
	servicePolicy: ConfigLayerRow | null;
	defaults: InstanceDefaults;
}

type Layer = { row: ConfigLayerRow; source: ConfigSource };

const layer = (
	kind: ConfigSource['layer'],
	row: ConfigLayerRow | null | undefined
): Layer | null => (row ? { row, source: { layer: kind, name: row.name ?? null } } : null);

const present = (layers: (Layer | null)[]): Layer[] => layers.filter((l): l is Layer => !!l);

/** First layer (in order) whose picked value is set, with that layer as source. */
function firstSourced<T>(
	layers: Layer[],
	pick: (row: ConfigLayerRow) => T | null | undefined
): Sourced<T> | undefined {
	for (const l of layers) {
		const v = pick(l.row);
		if (v !== null && v !== undefined) return { value: v, source: l.source };
	}
	return undefined;
}

/** A numeric field's first set value; null columns and non-numbers are skipped. */
function firstNumber(
	layers: Layer[],
	pick: (row: ConfigLayerRow) => string | number | null | undefined
): Sourced<number> | undefined {
	return firstSourced(layers, (row) => num(pick(row)));
}

/** Non-empty allowlists in cascade order (order is cosmetic — all apply). */
function sourcedLists(
	layers: Layer[],
	pick: (row: ConfigLayerRow) => string[] | null | undefined
): SourcedList[] {
	return layers.flatMap((l) => {
		const values = pick(l.row);
		return Array.isArray(values) && values.length > 0 ? [{ values, source: l.source }] : [];
	});
}

/** One budget scope: inline value first, then its preset; unset = 0 (unlimited). */
function resolveBudget(layers: Layer[]): SourcedBudget {
	return {
		daily: firstNumber(layers, (r) => r.dailyBudgetUsd) ?? { value: 0, source: null },
		monthly: firstNumber(layers, (r) => r.monthlyBudgetUsd) ?? { value: 0, source: null }
	};
}

/**
 * The effective config with the layer each value came from. Pure; the single
 * implementation of the cascade (resolveEffectiveConfig projects it to values).
 */
export function explainEffectiveConfig(input: ExplainInput): ExplainedConfig {
	const { defaults } = input;
	const tokenLayer = layer('token', input.token);
	const tokenPresetLayer = layer('tokenPreset', input.tokenPolicy);
	const serviceLayer = layer('service', input.service);
	const servicePresetLayer = layer('servicePreset', input.servicePolicy);
	// most specific first; the order decides the scalar overrides
	const all = present([tokenLayer, tokenPresetLayer, serviceLayer, servicePresetLayer]);
	const instance: ConfigSource = { layer: 'instance', name: null };

	return {
		providers: sourcedLists(all, (r) => r.allowedProviders),
		models: sourcedLists(all, (r) => r.allowedModels),
		preferredProvider: firstSourced(all, (r) => r.preferredProvider) ?? {
			value: null,
			source: null
		},
		rateLimitPerMinute: firstNumber(all, (r) => r.rateLimitPerMinute) ?? {
			value: 0,
			source: null
		},
		cacheTtlSeconds: firstNumber(all, (r) => r.cacheTtlSeconds) ?? {
			value: defaults.cacheTtlSeconds,
			source: instance
		},
		// a token-level cap only exists when a token is in scope
		tokenBudget: tokenLayer ? resolveBudget(present([tokenLayer, tokenPresetLayer])) : null,
		serviceBudget: resolveBudget(present([serviceLayer, servicePresetLayer])),
		// not a cascade — a single instance-wide value carried straight through
		instanceBudget: {
			daily: { value: defaults.dailyBudgetUsd, source: instance },
			monthly: { value: defaults.monthlyBudgetUsd, source: instance }
		}
	};
}

const blankInline = (row: ConfigLayerRow): ConfigLayerRow => ({
	name: row.name,
	allowedProviders: null,
	allowedModels: null,
	preferredProvider: null,
	rateLimitPerMinute: null,
	dailyBudgetUsd: null,
	monthlyBudgetUsd: null,
	cacheTtlSeconds: null
});

/**
 * What a token's or service's inline fields fall back to when left blank: the
 * cascade with that layer's inline values cleared (its preset still applies).
 * Feed the result through toInheritedLimits for the limits form.
 */
export function explainInherited(input: ExplainInput, scope: 'token' | 'service'): ExplainedConfig {
	if (scope === 'service') {
		return explainEffectiveConfig({
			service: blankInline(input.service),
			servicePolicy: input.servicePolicy,
			defaults: input.defaults
		});
	}
	return explainEffectiveConfig({
		...input,
		token: input.token ? blankInline(input.token) : input.token
	});
}

const budgetValues = (b: SourcedBudget): ResolvedBudget => ({
	dailyBudgetUsd: b.daily.value,
	monthlyBudgetUsd: b.monthly.value
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
		tokenBudget: budgetValues(e.tokenBudget ?? resolveBudget([])),
		serviceBudget: budgetValues(e.serviceBudget),
		instanceBudget: budgetValues(e.instanceBudget)
	};
}
