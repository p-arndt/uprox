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
 * supplied each value so the UI can show where a limit comes from. It lives
 * outside $lib/server and only depends on plain data so the forms can run the
 * same cascade in the browser while the user changes their selections.
 */
import {
	toInheritedLimits,
	type ConfigSource,
	type ExplainedConfig,
	type InheritedLimits,
	type Sourced,
	type SourcedBudget,
	type SourcedList
} from '$lib/features/policies/effective-config-view';

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

/** A layer with no inline values set, keeping its name for provenance labels. */
export const blankLayer = (name: string | null = null): ConfigLayerRow => ({
	name,
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
			service: blankLayer(input.service.name),
			servicePolicy: input.servicePolicy,
			defaults: input.defaults
		});
	}
	return explainEffectiveConfig({
		...input,
		token: input.token ? blankLayer(input.token.name) : input.token
	});
}

/**
 * A service row as the forms receive it: its inline layer plus its preset link.
 * Config columns are optional so callers holding only id/name still type-check;
 * a missing column counts as unset.
 */
export type ServiceLayerRow = Partial<ConfigLayerRow> & { id: string; policyId?: string | null };
/** A preset row as the forms receive it (same partial rule as ServiceLayerRow). */
export type PresetLayerRow = Partial<ConfigLayerRow> & { id: string };

function byId<T extends { id: string }>(
	rows: T[],
	id: string | null | undefined
): (T & ConfigLayerRow) | null {
	const row = id ? rows.find((r) => r.id === id) : undefined;
	return row ? { ...blankLayer(), ...row } : null;
}

/**
 * What a token form's blank fields inherit for the currently selected service
 * and token preset. An unknown or blank service id (the server will create the
 * Default service) contributes nothing, so only the presets and instance apply.
 */
export function inheritedForTokenForm(sel: {
	serviceId: string;
	policyId: string;
	services: ServiceLayerRow[];
	policies: PresetLayerRow[];
	defaults: InstanceDefaults;
}): InheritedLimits {
	const service = byId(sel.services, sel.serviceId);
	const config = explainInherited(
		{
			token: blankLayer(),
			tokenPolicy: byId(sel.policies, sel.policyId),
			service: service ?? blankLayer(),
			servicePolicy: byId(sel.policies, service?.policyId),
			defaults: sel.defaults
		},
		'token'
	);
	return toInheritedLimits(config, 'token');
}

/** What a service form's blank fields inherit for the currently selected preset. */
export function inheritedForServiceForm(sel: {
	policyId: string;
	policies: PresetLayerRow[];
	defaults: InstanceDefaults;
}): InheritedLimits {
	const config = explainInherited(
		{
			service: blankLayer(),
			servicePolicy: byId(sel.policies, sel.policyId),
			defaults: sel.defaults
		},
		'service'
	);
	return toInheritedLimits(config, 'service');
}
