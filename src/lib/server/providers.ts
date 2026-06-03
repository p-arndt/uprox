/**
 * Upstream provider registry. Every provider here speaks (or has) an
 * OpenAI-compatible surface, so the gateway can proxy a single request shape.
 */
import type { Capability } from '$lib/scopes';

export type { Capability };

export interface ProviderDef {
	id: string;
	label: string;
	/**
	 * OpenAI-compatible base URL, no trailing slash. Empty for providers whose
	 * endpoint is per-organization (see `requiresEndpoint`); the real base URL
	 * is then supplied by the org's stored secret.
	 */
	baseUrl: string;
	/** model-name prefixes used to route a request to this provider */
	modelPrefixes: string[];
	/** gateway endpoints this provider's upstream actually implements */
	capabilities: Capability[];
	/**
	 * How the upstream authenticates. 'bearer' sends `Authorization: Bearer <key>`
	 * (OpenAI, Anthropic); 'api-key' sends an `api-key: <key>` header (Azure).
	 * Defaults to 'bearer'.
	 */
	authScheme?: 'bearer' | 'api-key';
	/**
	 * When true the provider has no usable static `baseUrl`: each org configures
	 * its own endpoint (e.g. an Azure resource URL), stored on the secret and
	 * resolved by `resolveBaseUrl`.
	 */
	requiresEndpoint?: boolean;
	/**
	 * When true the provider serves arbitrary model names, not just those matching
	 * `modelPrefixes`. Azure deployment names are operator-chosen (e.g. "my-gpt4"),
	 * so once an org points OpenAI-compatible traffic at Azure, any model name that
	 * no other provider claims by prefix routes here. See `resolveProvider`.
	 */
	acceptsAnyModel?: boolean;
}

/**
 * The OpenAI-compatible model namespace. Shared by OpenAI and Azure OpenAI:
 * both speak the same API and the same model names, so an org can serve these
 * from either backend (see `resolveProvider` for how the two are disambiguated).
 */
const OPENAI_MODEL_PREFIXES = [
	'gpt-',
	'o1',
	'o3',
	'o4',
	'chatgpt',
	'text-embedding-',
	'dall-e',
	'whisper'
];

export const PROVIDERS: Record<string, ProviderDef> = {
	openai: {
		id: 'openai',
		label: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		modelPrefixes: OPENAI_MODEL_PREFIXES,
		capabilities: ['chat', 'responses', 'embeddings', 'models', 'images']
	},
	anthropic: {
		id: 'anthropic',
		label: 'Anthropic',
		// Anthropic exposes an OpenAI-compatible endpoint under /v1, but only for
		// chat completions and model listing — no Responses API, no embeddings.
		baseUrl: 'https://api.anthropic.com/v1',
		modelPrefixes: ['claude-'],
		capabilities: ['chat', 'models']
	},
	azure: {
		id: 'azure',
		label: 'Azure OpenAI',
		// Per-organization endpoint: the real base URL is the org's Azure resource
		// (e.g. https://my-resource.openai.azure.com), stored on its secret and
		// normalized to the v1 surface by resolveBaseUrl. We target Azure's newer
		// OpenAI-compatible `/openai/v1` API, so the same request shapes proxy
		// through unchanged.
		baseUrl: '',
		// Azure is an OpenAI-compatible drop-in: clients call the same model names
		// (no `azure/` alias). It shares OpenAI's prefixes so a policy can pick it
		// as the preferred backend for them, and accepts arbitrary names too, since
		// Azure deployment names are operator-chosen. See `resolveProvider`.
		modelPrefixes: OPENAI_MODEL_PREFIXES,
		capabilities: ['chat', 'responses', 'embeddings', 'models', 'images'],
		authScheme: 'api-key',
		requiresEndpoint: true,
		acceptsAnyModel: true
	}
};

/** Whether a provider implements a given gateway capability. */
export function providerSupports(provider: ProviderDef, capability: Capability): boolean {
	return provider.capabilities.includes(capability);
}

/** The fields of a stored provider secret that drive credential selection. */
export interface SelectableSecret {
	id: string;
	provider: string;
	priority: number;
	createdAt: Date;
}

/**
 * Pick which stored secret to use for a resolved provider. A provider may hold
 * several secrets (e.g. multiple Azure OpenAI resources). A service that pins a
 * specific secret (`preferSecretId`) wins, but only when that secret belongs to
 * the resolved provider — a pin to an Azure resource must not hijack an OpenAI
 * request. Otherwise the highest-`priority` secret is used, oldest first to
 * break ties so selection is stable as priorities change. Returns null when the
 * provider has no secret configured.
 */
export function selectProviderSecret<T extends SelectableSecret>(
	secrets: T[],
	provider: string,
	preferSecretId?: string | null
): T | null {
	const candidates = secrets.filter((s) => s.provider === provider);
	if (preferSecretId) {
		const pinned = candidates.find((s) => s.id === preferSecretId);
		if (pinned) return pinned;
	}
	return (
		candidates
			.slice()
			.sort(
				(a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime()
			)[0] ?? null
	);
}

/**
 * The effective OpenAI-compatible base URL for a provider. Providers without
 * `requiresEndpoint` use their static `baseUrl`. Endpoint-based providers
 * (Azure) take the org-supplied resource URL and normalize it to the v1
 * surface; returns null when no endpoint is configured.
 */
export function resolveBaseUrl(provider: ProviderDef, endpoint: string | null): string | null {
	if (!provider.requiresEndpoint) return provider.baseUrl;
	if (!endpoint) return null;
	const base = endpoint.trim().replace(/\/+$/, '');
	if (!base) return null;
	if (provider.id === 'azure' && !/\/openai\/v1$/.test(base)) return `${base}/openai/v1`;
	return base;
}

/** Auth header(s) for an upstream request, per the provider's auth scheme. */
export function authHeaders(provider: ProviderDef, apiKey: string): Record<string, string> {
	return provider.authScheme === 'api-key'
		? { 'api-key': apiKey }
		: { authorization: `Bearer ${apiKey}` };
}

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** Whether a provider claims a model name by one of its `modelPrefixes`. */
function matchesByPrefix(def: ProviderDef, model: string): boolean {
	return def.modelPrefixes.some((p) => model.startsWith(p));
}

/**
 * The canonical provider for a model name, by prefix alone and ignoring org
 * config. Used only for error messages (e.g. "no credentials configured for
 * OpenAI") — actual routing goes through `resolveProvider`, which is org-aware.
 * Since OpenAI and Azure share the same prefixes, this returns OpenAI for the
 * shared namespace (declaration order in `PROVIDERS`).
 */
export function providerForModel(model: string | undefined): ProviderDef | null {
	if (!model) return null;
	const m = model.toLowerCase();
	return Object.values(PROVIDERS).find((def) => matchesByPrefix(def, m)) ?? null;
}

/**
 * Pick the provider that should serve a model for a specific organization,
 * choosing only among the providers the org has actually configured.
 *
 * OpenAI and Azure share the OpenAI-compatible namespace, so a model like
 * `gpt-4o` can match both. When only one of them is configured, that one is
 * used. When both are, the policy's `preferredProvider` decides; with no
 * preference we fall back to `PROVIDERS` declaration order (OpenAI first), so
 * existing OpenAI orgs are unaffected by adding Azure. A model that no
 * configured provider claims by prefix falls back to a configured
 * `acceptsAnyModel` provider (Azure), supporting arbitrary Azure deployment
 * names. Returns null when nothing matches.
 */
export function resolveProvider(
	model: string | undefined,
	configuredProviderIds: string[],
	preferredProvider?: string | null
): ProviderDef | null {
	if (!model) return null;
	const m = model.toLowerCase();
	// configured providers, the preferred one first, then declaration order
	const defs = configuredProviderIds
		.map((id) => PROVIDERS[id])
		.filter((def): def is ProviderDef => Boolean(def))
		.sort(
			(a, b) =>
				(a.id === preferredProvider ? 0 : 1) - (b.id === preferredProvider ? 0 : 1) ||
				PROVIDER_IDS.indexOf(a.id) - PROVIDER_IDS.indexOf(b.id)
		);
	// prefer a provider that claims the model by prefix; otherwise fall back to a
	// catch-all (Azure) for arbitrary deployment names.
	return (
		defs.find((def) => matchesByPrefix(def, m)) ?? defs.find((def) => def.acceptsAnyModel) ?? null
	);
}

/**
 * Built-in per-model token prices in USD per 1M tokens. These are no longer
 * consulted at runtime — cost is read from the `model_price` table, which is
 * the single source of truth. This list exists only to seed the platform
 * defaults (NULL-org rows) on first migration; see `getDefaultModelPrices`.
 * Prices are intentionally approximate — good enough for spend tracking.
 */
/**
 * A resolved per-1M-token price. `cacheRead`/`cacheWrite` are the provider
 * prompt-cache rates; when absent they fall back to multipliers of `in` (read
 * 0.1×, write 1.25×) inside {@link costFromPrice}. cacheWrite is meaningful only
 * for Anthropic — OpenAI/Azure don't charge to write a cache entry, so their
 * requests carry zero cache-write tokens and the rate is never applied.
 */
export interface ModelPrice {
	in: number;
	out: number;
	cacheRead?: number;
	cacheWrite?: number;
}

function round4(n: number): number {
	return Math.round(n * 1e4) / 1e4;
}
// Anthropic prices cache traffic as fixed multiples of the input price: reads at
// 0.1×, 5-minute writes at 1.25×. Seed those explicitly so the dashboard shows
// real numbers; the same ratios back the NULL fallback in costFromPrice.
const anthropic = (input: number, out: number): ModelPrice => ({
	in: input,
	out,
	cacheRead: round4(input * 0.1),
	cacheWrite: round4(input * 1.25)
});
// OpenAI/Azure charge only a read discount (no write cost). The discount varies
// by family: the GPT-5 series caches at 0.1× input, GPT-4.x/o-series at ~0.5×.
const openai = (input: number, out: number, readRatio: number): ModelPrice => ({
	in: input,
	out,
	cacheRead: round4(input * readRatio)
});

export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
	// OpenAI — current GPT-5 series (most specific keys first, see lookup note below)
	'gpt-5.5-pro': openai(30, 180, 0.1),
	'gpt-5.5': openai(5, 30, 0.1),
	'gpt-5.4-pro': openai(30, 180, 0.1),
	'gpt-5.4-mini': openai(0.75, 4.5, 0.1),
	'gpt-5.4-nano': openai(0.2, 1.25, 0.1),
	'gpt-5.4': openai(2.5, 15, 0.1),
	// OpenAI — older models (GPT-4.x / o-series cache reads at ~0.5× input)
	'gpt-4o': openai(2.5, 10, 0.5),
	'gpt-4o-mini': openai(0.15, 0.6, 0.5),
	'gpt-4.1': openai(2, 8, 0.5),
	'gpt-4.1-mini': openai(0.4, 1.6, 0.5),
	o3: openai(2, 8, 0.5),
	// OpenAI — embeddings (input-only; no output tokens and no prompt caching)
	'text-embedding-3-small': { in: 0.02, out: 0 },
	'text-embedding-3-large': { in: 0.13, out: 0 },
	// Anthropic — current Claude 4.x series
	'claude-opus-4-7': anthropic(5, 25),
	'claude-opus-4-6': anthropic(5, 25),
	'claude-opus-4-5': anthropic(5, 25),
	'claude-opus-4-1': anthropic(15, 75),
	'claude-sonnet-4-6': anthropic(3, 15),
	'claude-sonnet-4-5': anthropic(3, 15),
	'claude-haiku-4-5': anthropic(1, 5),
	// Anthropic — older models
	'claude-3-5-sonnet': anthropic(3, 15),
	'claude-3-5-haiku': anthropic(0.8, 4),
	'claude-sonnet-4': anthropic(3, 15)
};

/** Fallback cache-rate multipliers of the input price when a price is unset. */
const FALLBACK_CACHE_READ_MULT = 0.1;
const FALLBACK_CACHE_WRITE_MULT = 1.25;

/**
 * Compute USD cost from a resolved per-1M-token price and token counts.
 *
 * `promptTokens` is the *total* input volume including any cache read/write
 * tokens (OpenAI's `prompt_tokens` already is; the gateway folds Anthropic's
 * separate cache counts into it). The full-price portion is what's left after
 * subtracting the cache tokens, which are billed at their own rates. When a
 * cache rate is unset it falls back to a multiple of the input price.
 */
export function costFromPrice(
	price: ModelPrice,
	promptTokens: number,
	completionTokens: number | undefined,
	cacheReadTokens = 0,
	cacheWriteTokens = 0
): number {
	const cacheReadRate = price.cacheRead ?? price.in * FALLBACK_CACHE_READ_MULT;
	const cacheWriteRate = price.cacheWrite ?? price.in * FALLBACK_CACHE_WRITE_MULT;
	const fullPriceInput = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
	const cost =
		(fullPriceInput * price.in +
			cacheReadTokens * cacheReadRate +
			cacheWriteTokens * cacheWriteRate +
			(completionTokens ?? 0) * price.out) /
		1_000_000;
	// Round to 8 decimals: rounding to 1e-6 floored cheap models (e.g. gpt-5.4-nano)
	// to 0 on small requests, since their per-token cost is well below a micro-dollar.
	return Math.round(cost * 1e8) / 1e8;
}

/**
 * Resolve the longest-prefix price for a model from a price map, matching the
 * legacy lookup: e.g. "gpt-5.4-mini" wins over "gpt-5.4".
 */
export function resolvePrice(prices: Record<string, ModelPrice>, model: string): ModelPrice | null {
	const m = model.toLowerCase();
	const key = Object.keys(prices)
		.sort((a, b) => b.length - a.length)
		.find((k) => m.startsWith(k));
	return key ? prices[key] : null;
}

/**
 * Estimate a request's USD cost. Reads the instance's effective price map
 * (custom overrides layered over platform defaults) from the database via a
 * short-lived in-memory cache, then matches the model by longest prefix.
 * `promptTokens` is the total input volume; `cacheReadTokens`/`cacheWriteTokens`
 * are the cache subsets within it, priced separately. Returns null when the
 * model has no price or no prompt tokens were reported.
 */
export async function estimateCostUsd(
	model: string | undefined,
	promptTokens: number | undefined,
	completionTokens: number | undefined,
	cacheReadTokens = 0,
	cacheWriteTokens = 0
): Promise<number | null> {
	if (!model || promptTokens == null) return null;
	const { getEffectivePriceMap } = await import('$lib/server/pricing');
	const prices = await getEffectivePriceMap();
	const price = resolvePrice(prices, model);
	if (!price) return null;
	return costFromPrice(
		price,
		promptTokens,
		completionTokens ?? 0,
		cacheReadTokens,
		cacheWriteTokens
	);
}
