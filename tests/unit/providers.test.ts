import { describe, it, expect } from 'vitest';
import {
	PROVIDERS,
	providerSupports,
	resolveBaseUrl,
	authHeaders,
	providerForModel,
	resolveProvider,
	selectProviderSecret,
	costFromPrice,
	resolvePrice
} from '$lib/server/providers';

describe('providerSupports', () => {
	it('reflects each provider capability set', () => {
		expect(providerSupports(PROVIDERS.openai, 'responses')).toBe(true);
		expect(providerSupports(PROVIDERS.openai, 'embeddings')).toBe(true);
		// Anthropic's OpenAI-compatible surface is chat + models only
		expect(providerSupports(PROVIDERS.anthropic, 'chat')).toBe(true);
		expect(providerSupports(PROVIDERS.anthropic, 'responses')).toBe(false);
		expect(providerSupports(PROVIDERS.anthropic, 'embeddings')).toBe(false);
		// image generation: OpenAI and Azure serve it; Anthropic does not
		expect(providerSupports(PROVIDERS.openai, 'images')).toBe(true);
		expect(providerSupports(PROVIDERS.azure, 'images')).toBe(true);
		expect(providerSupports(PROVIDERS.anthropic, 'images')).toBe(false);
	});
});

describe('resolveBaseUrl', () => {
	it('returns the static base URL for non-endpoint providers', () => {
		expect(resolveBaseUrl(PROVIDERS.openai, null)).toBe('https://api.openai.com/v1');
		// an endpoint passed to a static provider is ignored
		expect(resolveBaseUrl(PROVIDERS.anthropic, 'https://ignored')).toBe(
			'https://api.anthropic.com/v1'
		);
	});

	it('requires an endpoint for Azure and normalizes it to the /openai/v1 surface', () => {
		expect(resolveBaseUrl(PROVIDERS.azure, null)).toBeNull();
		expect(resolveBaseUrl(PROVIDERS.azure, '')).toBeNull();
		expect(resolveBaseUrl(PROVIDERS.azure, 'https://my-res.openai.azure.com')).toBe(
			'https://my-res.openai.azure.com/openai/v1'
		);
	});

	it('strips trailing slashes and does not double-append the v1 suffix', () => {
		expect(resolveBaseUrl(PROVIDERS.azure, 'https://my-res.openai.azure.com/')).toBe(
			'https://my-res.openai.azure.com/openai/v1'
		);
		expect(resolveBaseUrl(PROVIDERS.azure, 'https://my-res.openai.azure.com/openai/v1')).toBe(
			'https://my-res.openai.azure.com/openai/v1'
		);
	});
});

describe('authHeaders', () => {
	it('uses a Bearer Authorization header by default', () => {
		expect(authHeaders(PROVIDERS.openai, 'sk-123')).toEqual({ authorization: 'Bearer sk-123' });
	});

	it('uses an api-key header for the api-key scheme (Azure)', () => {
		expect(authHeaders(PROVIDERS.azure, 'azkey')).toEqual({ 'api-key': 'azkey' });
	});
});

describe('providerForModel', () => {
	it('routes by prefix, case-insensitively', () => {
		expect(providerForModel('claude-opus-4-7')?.id).toBe('anthropic');
		expect(providerForModel('GPT-4o')?.id).toBe('openai');
	});

	it('returns OpenAI for the shared OpenAI/Azure namespace (declaration order)', () => {
		expect(providerForModel('gpt-4o')?.id).toBe('openai');
		expect(providerForModel('text-embedding-3-small')?.id).toBe('openai');
	});

	it('returns null for unknown models or missing input', () => {
		expect(providerForModel('mystery-model')).toBeNull();
		expect(providerForModel(undefined)).toBeNull();
	});
});

describe('resolveProvider', () => {
	it('returns null when nothing is configured', () => {
		expect(resolveProvider('gpt-4o', [])).toBeNull();
	});

	it('picks the only configured provider that claims the model', () => {
		expect(resolveProvider('gpt-4o', ['openai'])?.id).toBe('openai');
		expect(resolveProvider('claude-opus-4-7', ['anthropic', 'openai'])?.id).toBe('anthropic');
	});

	it('falls back to declaration order (OpenAI first) when both share the namespace', () => {
		expect(resolveProvider('gpt-4o', ['azure', 'openai'])?.id).toBe('openai');
	});

	it('honours the policy preferredProvider to break the OpenAI/Azure tie', () => {
		expect(resolveProvider('gpt-4o', ['openai', 'azure'], 'azure')?.id).toBe('azure');
		expect(resolveProvider('gpt-4o', ['openai', 'azure'], 'openai')?.id).toBe('openai');
	});

	it('routes an unrecognized model to a configured acceptsAnyModel provider (Azure)', () => {
		expect(resolveProvider('my-custom-deployment', ['azure'])?.id).toBe('azure');
		// ...but not to OpenAI, which only claims its prefixes
		expect(resolveProvider('my-custom-deployment', ['openai'])).toBeNull();
	});

	it('does not route a claude model to a configured OpenAI-only org, but Azure catches it', () => {
		expect(resolveProvider('claude-opus-4-7', ['openai'])).toBeNull();
		expect(resolveProvider('claude-opus-4-7', ['azure'])?.id).toBe('azure');
	});
});

describe('selectProviderSecret', () => {
	const d = (s: string) => new Date(s);
	const secrets = [
		{ id: 'az-eu', provider: 'azure', priority: 10, createdAt: d('2026-01-01') },
		{ id: 'az-us', provider: 'azure', priority: 5, createdAt: d('2026-01-02') },
		{ id: 'az-old', provider: 'azure', priority: 10, createdAt: d('2025-12-01') },
		{ id: 'oai', provider: 'openai', priority: 0, createdAt: d('2026-01-03') }
	];

	it('returns null when the provider has no secret', () => {
		expect(selectProviderSecret(secrets, 'anthropic')).toBeNull();
		expect(selectProviderSecret([], 'azure')).toBeNull();
	});

	it('picks the highest-priority secret for the provider, oldest breaking ties', () => {
		// az-eu and az-old both priority 10; az-old is older, so it wins the tie
		expect(selectProviderSecret(secrets, 'azure')?.id).toBe('az-old');
		expect(selectProviderSecret(secrets, 'openai')?.id).toBe('oai');
	});

	it('honours a pinned secret that belongs to the provider', () => {
		expect(selectProviderSecret(secrets, 'azure', 'az-us')?.id).toBe('az-us');
	});

	it('ignores a pin to another provider and falls back to the default', () => {
		// pinning the OpenAI secret must not hijack an Azure request
		expect(selectProviderSecret(secrets, 'azure', 'oai')?.id).toBe('az-old');
	});

	it('ignores a pin to a deleted/unknown secret and falls back to the default', () => {
		expect(selectProviderSecret(secrets, 'azure', 'gone')?.id).toBe('az-old');
	});
});

describe('costFromPrice', () => {
	const price = { in: 2.5, out: 10 }; // gpt-4o, USD per 1M tokens

	it('computes input + output cost per million tokens', () => {
		// 1M input @ $2.5 + 1M output @ $10 = $12.5
		expect(costFromPrice(price, 1_000_000, 1_000_000)).toBe(12.5);
	});

	it('treats missing completion tokens as zero', () => {
		expect(costFromPrice(price, 1_000_000, undefined)).toBe(2.5);
	});

	it('rounds to 8 decimals so cheap models do not floor to zero', () => {
		const nano = { in: 0.2, out: 1.25 };
		// 10 input tokens → 10 * 0.2 / 1e6 = 0.000002 → preserved at 8 decimals
		expect(costFromPrice(nano, 10, 0)).toBe(0.000002);
	});
});

describe('resolvePrice', () => {
	const prices = {
		'gpt-5.4': { in: 2.5, out: 15 },
		'gpt-5.4-mini': { in: 0.75, out: 4.5 },
		'gpt-4o': { in: 2.5, out: 10 }
	};

	it('matches by longest prefix so the more specific key wins', () => {
		expect(resolvePrice(prices, 'gpt-5.4-mini-2026')).toBe(prices['gpt-5.4-mini']);
		expect(resolvePrice(prices, 'gpt-5.4-turbo')).toBe(prices['gpt-5.4']);
	});

	it('is case-insensitive on the model name', () => {
		expect(resolvePrice(prices, 'GPT-4o')).toBe(prices['gpt-4o']);
	});

	it('returns null when no prefix matches', () => {
		expect(resolvePrice(prices, 'claude-opus-4-7')).toBeNull();
	});
});
