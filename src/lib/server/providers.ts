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
	 * Model-name prefix that selects this provider and is stripped to form the
	 * upstream model/deployment name. A client calls `azure/<deployment>`; we
	 * route to Azure and send the bare `<deployment>` upstream. See `upstreamModel`.
	 */
	routePrefix?: string;
}

export const PROVIDERS: Record<string, ProviderDef> = {
	openai: {
		id: 'openai',
		label: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		modelPrefixes: ['gpt-', 'o1', 'o3', 'o4', 'chatgpt', 'text-embedding-', 'dall-e', 'whisper'],
		capabilities: ['chat', 'responses', 'embeddings', 'models']
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
		// Deployment names are arbitrary, so we route on an explicit alias rather
		// than model prefixes: a client calls `azure/<deployment>`.
		modelPrefixes: ['azure/'],
		capabilities: ['chat', 'responses', 'embeddings', 'models'],
		authScheme: 'api-key',
		requiresEndpoint: true,
		routePrefix: 'azure/'
	}
};

/** Whether a provider implements a given gateway capability. */
export function providerSupports(provider: ProviderDef, capability: Capability): boolean {
	return provider.capabilities.includes(capability);
}

/**
 * Strip a provider's `routePrefix` to get the bare upstream model/deployment
 * name. For Azure, `azure/gpt-4o` → `gpt-4o`. A no-op for providers (OpenAI,
 * Anthropic) that route by model prefix and pass the model through unchanged.
 */
export function upstreamModel(provider: ProviderDef, model: string): string {
	if (provider.routePrefix && model.startsWith(provider.routePrefix)) {
		return model.slice(provider.routePrefix.length);
	}
	return model;
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

/** Infer which provider should serve a given model name. */
export function providerForModel(model: string | undefined): ProviderDef | null {
	if (!model) return null;
	const m = model.toLowerCase();
	for (const def of Object.values(PROVIDERS)) {
		if (def.modelPrefixes.some((p) => m.startsWith(p))) return def;
	}
	return null;
}

/**
 * Very rough USD cost estimate from token usage. Prices are per 1M tokens and
 * intentionally approximate — good enough for spend tracking in the MVP.
 */
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
	// OpenAI — current GPT-5 series (most specific keys first, see lookup note below)
	'gpt-5.5-pro': { in: 30, out: 180 },
	'gpt-5.5': { in: 5, out: 30 },
	'gpt-5.4-pro': { in: 30, out: 180 },
	'gpt-5.4-mini': { in: 0.75, out: 4.5 },
	'gpt-5.4-nano': { in: 0.2, out: 1.25 },
	'gpt-5.4': { in: 2.5, out: 15 },
	// OpenAI — older models
	'gpt-4o': { in: 2.5, out: 10 },
	'gpt-4o-mini': { in: 0.15, out: 0.6 },
	'gpt-4.1': { in: 2, out: 8 },
	'gpt-4.1-mini': { in: 0.4, out: 1.6 },
	o3: { in: 2, out: 8 },
	// Anthropic — current Claude 4.x series
	'claude-opus-4-7': { in: 5, out: 25 },
	'claude-opus-4-6': { in: 5, out: 25 },
	'claude-opus-4-5': { in: 5, out: 25 },
	'claude-opus-4-1': { in: 15, out: 75 },
	'claude-sonnet-4-6': { in: 3, out: 15 },
	'claude-sonnet-4-5': { in: 3, out: 15 },
	'claude-haiku-4-5': { in: 1, out: 5 },
	// Anthropic — older models
	'claude-3-5-sonnet': { in: 3, out: 15 },
	'claude-3-5-haiku': { in: 0.8, out: 4 },
	'claude-sonnet-4': { in: 3, out: 15 }
};

export function estimateCostUsd(
	model: string | undefined,
	promptTokens: number | undefined,
	completionTokens: number | undefined
): number | null {
	if (!model || promptTokens == null) return null;
	const m = model.toLowerCase();
	// Match the longest key first so e.g. "gpt-5.4-mini" wins over "gpt-5.4".
	const key = Object.keys(PRICE_PER_MTOK)
		.sort((a, b) => b.length - a.length)
		.find((k) => m.startsWith(k));
	if (!key) return null;
	const price = PRICE_PER_MTOK[key];
	const cost = (promptTokens * price.in + (completionTokens ?? 0) * price.out) / 1_000_000;
	// Round to 8 decimals: rounding to 1e-6 floored cheap models (e.g. gpt-5.4-nano)
	// to 0 on small requests, since their per-token cost is well below a micro-dollar.
	return Math.round(cost * 1e8) / 1e8;
}
