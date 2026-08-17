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
	resolvePrice,
	DEFAULT_MODEL_PRICES,
	LONG_CONTEXT_MIN_PROMPT_TOKENS
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
		// Native Gemini covers chat + embeddings + models, but not the Responses
		// API or image generation (a separate native endpoint we don't translate).
		expect(providerSupports(PROVIDERS.gemini, 'chat')).toBe(true);
		expect(providerSupports(PROVIDERS.gemini, 'embeddings')).toBe(true);
		expect(providerSupports(PROVIDERS.gemini, 'images')).toBe(false);
		expect(providerSupports(PROVIDERS.gemini, 'responses')).toBe(false);
		// The custom OpenAI-compatible provider claims every capability — the
		// operator's endpoint decides what actually works.
		expect(providerSupports(PROVIDERS.custom, 'chat')).toBe(true);
		expect(providerSupports(PROVIDERS.custom, 'responses')).toBe(true);
		expect(providerSupports(PROVIDERS.custom, 'images')).toBe(true);
		// audio transcription: OpenAI/Azure/custom serve it; Anthropic and native
		// Gemini (no OpenAI-compatible audio surface) do not.
		expect(providerSupports(PROVIDERS.openai, 'transcriptions')).toBe(true);
		expect(providerSupports(PROVIDERS.azure, 'transcriptions')).toBe(true);
		expect(providerSupports(PROVIDERS.custom, 'transcriptions')).toBe(true);
		expect(providerSupports(PROVIDERS.anthropic, 'transcriptions')).toBe(false);
		expect(providerSupports(PROVIDERS.gemini, 'transcriptions')).toBe(false);
		// realtime ephemeral tokens: OpenAI/Azure/custom; not Anthropic or Gemini.
		expect(providerSupports(PROVIDERS.openai, 'realtime')).toBe(true);
		expect(providerSupports(PROVIDERS.azure, 'realtime')).toBe(true);
		expect(providerSupports(PROVIDERS.custom, 'realtime')).toBe(true);
		expect(providerSupports(PROVIDERS.anthropic, 'realtime')).toBe(false);
		expect(providerSupports(PROVIDERS.gemini, 'realtime')).toBe(false);
		// Ollama's OpenAI surface covers chat, embeddings, models and Responses
		// (non-stateful only); it has no images/transcriptions/realtime surface.
		expect(providerSupports(PROVIDERS.ollama, 'chat')).toBe(true);
		expect(providerSupports(PROVIDERS.ollama, 'embeddings')).toBe(true);
		expect(providerSupports(PROVIDERS.ollama, 'models')).toBe(true);
		expect(providerSupports(PROVIDERS.ollama, 'responses')).toBe(true);
		expect(providerSupports(PROVIDERS.ollama, 'images')).toBe(false);
		expect(providerSupports(PROVIDERS.ollama, 'transcriptions')).toBe(false);
		expect(providerSupports(PROVIDERS.ollama, 'realtime')).toBe(false);
	});
});

describe('resolveBaseUrl', () => {
	it('returns the static base URL for non-endpoint providers', () => {
		expect(resolveBaseUrl(PROVIDERS.openai, null)).toBe('https://api.openai.com/v1');
		// an endpoint passed to a static provider is ignored
		expect(resolveBaseUrl(PROVIDERS.anthropic, 'https://ignored')).toBe(
			'https://api.anthropic.com/v1'
		);
		expect(resolveBaseUrl(PROVIDERS.gemini, null)).toBe(
			'https://generativelanguage.googleapis.com/v1beta'
		);
	});

	it('uses the custom provider endpoint verbatim (no path normalization)', () => {
		expect(resolveBaseUrl(PROVIDERS.custom, null)).toBeNull();
		expect(resolveBaseUrl(PROVIDERS.custom, 'https://api.groq.com/openai/v1')).toBe(
			'https://api.groq.com/openai/v1'
		);
		// trailing slashes are stripped, but the path is otherwise untouched
		expect(resolveBaseUrl(PROVIDERS.custom, 'https://my-vllm.internal:8000/v1/')).toBe(
			'https://my-vllm.internal:8000/v1'
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

	it('appends the /v1 suffix to an Ollama host but not when already present', () => {
		expect(resolveBaseUrl(PROVIDERS.ollama, null)).toBeNull();
		// a bare host (the common case) gets the OpenAI-compatible /v1 path appended
		expect(resolveBaseUrl(PROVIDERS.ollama, 'http://localhost:11434')).toBe(
			'http://localhost:11434/v1'
		);
		// trailing slash is stripped before the suffix check
		expect(resolveBaseUrl(PROVIDERS.ollama, 'http://localhost:11434/')).toBe(
			'http://localhost:11434/v1'
		);
		// an endpoint that already targets /v1 is left as-is
		expect(resolveBaseUrl(PROVIDERS.ollama, 'https://ollama.internal/v1')).toBe(
			'https://ollama.internal/v1'
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

	it('uses an x-goog-api-key header for the google scheme (native Gemini)', () => {
		expect(authHeaders(PROVIDERS.gemini, 'gkey')).toEqual({ 'x-goog-api-key': 'gkey' });
	});

	it('base64-encodes "user:pass" into a Basic header for the basic scheme (Ollama)', () => {
		// "alice:s3cret" → base64 "YWxpY2U6czNjcmV0"
		expect(authHeaders(PROVIDERS.ollama, 'alice:s3cret')).toEqual({
			authorization: `Basic ${Buffer.from('alice:s3cret').toString('base64')}`
		});
	});

	it('sends no auth header when the optional basic credential is blank (Ollama)', () => {
		expect(authHeaders(PROVIDERS.ollama, '')).toEqual({});
	});
});

describe('providerForModel', () => {
	it('routes by prefix, case-insensitively', () => {
		expect(providerForModel('claude-opus-4-7')?.id).toBe('anthropic');
		expect(providerForModel('GPT-4o')?.id).toBe('openai');
		// Gemini's prefixes don't collide with any other provider's namespace
		expect(providerForModel('gemini-2.5-flash')?.id).toBe('gemini');
		expect(providerForModel('Gemini-3.5-Flash')?.id).toBe('gemini');
		expect(providerForModel('gemma-3-27b')?.id).toBe('gemini');
		expect(providerForModel('gemini-embedding-001')?.id).toBe('gemini');
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
		expect(resolveProvider('gemini-2.5-pro', ['openai', 'gemini'])?.id).toBe('gemini');
	});

	it('does not route a gemini model to a configured non-gemini org', () => {
		expect(resolveProvider('gemini-2.5-pro', ['openai', 'anthropic'])).toBeNull();
		// ...but a configured Azure catch-all still claims it, as for any unknown name
		expect(resolveProvider('gemini-2.5-pro', ['azure'])?.id).toBe('azure');
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

describe('embedding default prices', () => {
	it('ships defaults for the two current OpenAI embedding models', () => {
		expect(DEFAULT_MODEL_PRICES['text-embedding-3-small']).toEqual({ in: 0.02, out: 0 });
		expect(DEFAULT_MODEL_PRICES['text-embedding-3-large']).toEqual({ in: 0.13, out: 0 });
	});

	it('prices an embedding request on its input tokens only (no output cost)', () => {
		const small = DEFAULT_MODEL_PRICES['text-embedding-3-small'];
		// 1M input tokens @ $0.02; embeddings report 0 completion tokens
		expect(costFromPrice(small, 1_000_000, 0)).toBe(0.02);
	});
});

describe('costFromPrice with cache tokens', () => {
	it('discounts OpenAI cached reads within the total input (gpt-4o, 0.5×)', () => {
		const price = { in: 2.5, out: 10, cacheRead: 1.25 };
		// prompt_tokens already includes cached_tokens: 1M total, 800k cached.
		// full-price = 200k @ $2.5 + 800k @ $1.25 = 0.5 + 1.0 = $1.5
		expect(costFromPrice(price, 1_000_000, 0, 800_000, 0)).toBe(1.5);
	});

	it('adds Anthropic cache read + write on top of base input', () => {
		const price = { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 };
		// gateway folds Anthropic counts into the total: 100 base + 5000 read + 2000 write.
		// 100 @ $3 + 5000 @ $0.3 + 2000 @ $3.75 = 300 + 1500 + 7500 = $0.0093 per 1M
		expect(costFromPrice(price, 7100, 0, 5000, 2000)).toBe(0.0093);
	});

	it('falls back to input-price multipliers when cache rates are unset', () => {
		const price = { in: 3, out: 15 };
		// read fallback 0.1×: 1M cached read @ $0.3 = $0.3
		expect(costFromPrice(price, 1_000_000, 0, 1_000_000, 0)).toBe(0.3);
		// write fallback 1.25×: 1M cache write @ $3.75 = $3.75
		expect(costFromPrice(price, 1_000_000, 0, 0, 1_000_000)).toBe(3.75);
	});

	it('clamps the full-price portion to zero if cache tokens exceed input', () => {
		const price = { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 };
		// defensive: never bills negative full-price input
		expect(costFromPrice(price, 1000, 0, 800, 800)).toBe((800 * 0.3 + 800 * 3.75) / 1e6);
	});
});

describe('long-context pricing', () => {
	const sol = DEFAULT_MODEL_PRICES['gpt-5.6-sol'];

	it('bills the standard card right up to the threshold', () => {
		// 1 token below: 271_999 @ $5/1M
		expect(costFromPrice(sol, LONG_CONTEXT_MIN_PROMPT_TOKENS - 1, 0)).toBe(
			((LONG_CONTEXT_MIN_PROMPT_TOKENS - 1) * 5) / 1e6
		);
	});

	it('flips the whole request — output included — at the threshold', () => {
		// exactly at the threshold: input @ $10/1M and output @ $45/1M, not $5/$30
		expect(costFromPrice(sol, LONG_CONTEXT_MIN_PROMPT_TOKENS, 1_000)).toBe(
			(LONG_CONTEXT_MIN_PROMPT_TOKENS * 10 + 1_000 * 45) / 1e6
		);
	});

	it('prices long-context cache traffic at the long rates', () => {
		// 300k prompt = 200k cache reads + 50k cache writes + 50k fresh input
		// 50k @ $10 + 200k @ $1 + 50k @ $12.50 + 1k out @ $45
		expect(costFromPrice(sol, 300_000, 1_000, 200_000, 50_000)).toBe(
			(50_000 * 10 + 200_000 * 1 + 50_000 * 12.5 + 1_000 * 45) / 1e6
		);
	});

	it('keeps single-rate-card models on the standard rates at any prompt size', () => {
		const nano = DEFAULT_MODEL_PRICES['gpt-5.4-nano'];
		expect(nano.longIn).toBeUndefined();
		expect(costFromPrice(nano, 1_000_000, 0)).toBe(0.2);
	});

	it('falls back to the long input rate for an unset long cache rate', () => {
		// a custom row with a long card but no long cache rates: read 0.1× / write
		// 1.25× of the *long* input price, not the standard one
		const price = { in: 3, out: 15, longIn: 6, longOut: 22.5 };
		expect(costFromPrice(price, 300_000, 0, 300_000, 0)).toBe((300_000 * 0.6) / 1e6);
		expect(costFromPrice(price, 300_000, 0, 0, 300_000)).toBe((300_000 * 7.5) / 1e6);
	});
});

describe('cache default prices', () => {
	it('seeds Anthropic cache reads at 0.1× and writes at 1.25× input', () => {
		expect(DEFAULT_MODEL_PRICES['claude-sonnet-4-6']).toEqual({
			in: 3,
			out: 15,
			cacheRead: 0.3,
			cacheWrite: 3.75
		});
	});

	it('seeds the Claude 5 series, cache rates included', () => {
		// cacheWrite is Anthropic's 5-minute TTL rate (1.25× input). The 1-hour TTL
		// write costs 2× input upstream, which a single cache_write column can't
		// express — those writes are billed here at the 5m rate.
		expect(DEFAULT_MODEL_PRICES['claude-fable-5']).toEqual({
			in: 10,
			out: 50,
			cacheRead: 1,
			cacheWrite: 12.5
		});
		expect(DEFAULT_MODEL_PRICES['claude-mythos-5']).toEqual({
			in: 10,
			out: 50,
			cacheRead: 1,
			cacheWrite: 12.5
		});
		expect(DEFAULT_MODEL_PRICES['claude-opus-5']).toEqual({
			in: 5,
			out: 25,
			cacheRead: 0.5,
			cacheWrite: 6.25
		});
		expect(DEFAULT_MODEL_PRICES['claude-opus-4-8']).toEqual({
			in: 5,
			out: 25,
			cacheRead: 0.5,
			cacheWrite: 6.25
		});
		// introductory pricing through 2026-08-31; reverts to $3/$15 on 2026-09-01
		expect(DEFAULT_MODEL_PRICES['claude-sonnet-5']).toEqual({
			in: 2,
			out: 10,
			cacheRead: 0.2,
			cacheWrite: 2.5
		});
	});

	it('resolves dated Claude 5 ids without colliding with the 4.x rows', () => {
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'claude-opus-5-20260115')).toBe(
			DEFAULT_MODEL_PRICES['claude-opus-5']
		);
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'claude-sonnet-5')).toBe(
			DEFAULT_MODEL_PRICES['claude-sonnet-5']
		);
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'claude-opus-4-8')).toBe(
			DEFAULT_MODEL_PRICES['claude-opus-4-8']
		);
	});

	it('seeds pre-5.6 OpenAI writes at the plain input rate (no surcharge)', () => {
		// GPT-5 series reads at 0.1×, GPT-4o at 0.5×; neither surcharges writes, so
		// cacheWrite == in. Leaving it unset would hand these models the 1.25×
		// fallback and overcharge every cache write the provider reports.
		expect(DEFAULT_MODEL_PRICES['gpt-5.4']).toMatchObject({
			in: 2.5,
			out: 15,
			cacheRead: 0.25,
			cacheWrite: 2.5
		});
		expect(DEFAULT_MODEL_PRICES['gpt-4o']).toEqual({
			in: 2.5,
			out: 10,
			cacheRead: 1.25,
			cacheWrite: 2.5
		});
	});

	it('seeds the GPT-5.6 tiers, which bill cache writes at 1.25× input', () => {
		expect(DEFAULT_MODEL_PRICES['gpt-5.6-sol']).toEqual({
			in: 5,
			out: 30,
			cacheRead: 0.5,
			cacheWrite: 6.25,
			longIn: 10,
			longOut: 45,
			longCacheRead: 1,
			longCacheWrite: 12.5
		});
		expect(DEFAULT_MODEL_PRICES['gpt-5.6-terra']).toEqual({
			in: 2,
			out: 12,
			cacheRead: 0.2,
			cacheWrite: 2.5,
			longIn: 4,
			longOut: 18,
			longCacheRead: 0.4,
			longCacheWrite: 5
		});
		expect(DEFAULT_MODEL_PRICES['gpt-5.6-luna']).toEqual({
			in: 0.2,
			out: 1.2,
			cacheRead: 0.02,
			cacheWrite: 0.25,
			longIn: 0.4,
			longOut: 1.8,
			longCacheRead: 0.04,
			longCacheWrite: 0.5
		});
	});

	it('prices a GPT-5.6 request with both cache reads and writes', () => {
		const price = DEFAULT_MODEL_PRICES['gpt-5.6-sol'];
		// prompt_tokens 10k = 6k cache reads + 3k cache writes + 1k fresh input.
		// 1k @ $5 + 6k @ $0.5 + 3k @ $6.25 + 500 out @ $30
		// = 5000 + 3000 + 18750 + 15000 = 41750 per 1M = $0.04175
		expect(costFromPrice(price, 10_000, 500, 6_000, 3_000)).toBe(0.04175);
	});

	it('bills a pre-5.6 OpenAI cache write as plain input, never at the 1.25× fallback', () => {
		const price = DEFAULT_MODEL_PRICES['gpt-5.5'];
		expect(price.cacheWrite).toBe(price.in);
		expect(price.longCacheWrite).toBe(price.longIn);
		// 200k written tokens must cost the same as 200k ordinary input tokens,
		// not the 1.25× the unset-rate fallback would charge.
		expect(costFromPrice(price, 200_000, 0, 0, 200_000)).toBe(
			costFromPrice(price, 200_000, 0, 0, 0)
		);
	});

	it('leaves the pro tiers without a cache discount — they bill cache traffic as input', () => {
		for (const model of ['gpt-5.5-pro', 'gpt-5.4-pro']) {
			const price = DEFAULT_MODEL_PRICES[model];
			expect(price.cacheRead).toBe(price.in);
			expect(price.cacheWrite).toBe(price.in);
		}
	});

	it('resolves dated GPT-5.6 ids to their tier price', () => {
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'gpt-5.6-luna-2026-02-16')).toBe(
			DEFAULT_MODEL_PRICES['gpt-5.6-luna']
		);
	});

	it('seeds Gemini with a cache read discount and no write surcharge', () => {
		expect(DEFAULT_MODEL_PRICES['gemini-2.5-flash']).toEqual({
			in: 0.3,
			out: 2.5,
			cacheRead: 0.03,
			cacheWrite: 0.3
		});
		expect(DEFAULT_MODEL_PRICES['gemini-3.5-flash']).toEqual({
			in: 1.5,
			out: 9,
			cacheRead: 0.15,
			cacheWrite: 1.5
		});
		// embedding model: input-only, no output cost and no cache rate
		expect(DEFAULT_MODEL_PRICES['gemini-embedding-001']).toEqual({ in: 0.15, out: 0 });
	});
});

describe('gemini price lookup by longest prefix', () => {
	it('prefers flash-lite over flash for the more specific model name', () => {
		// flash-lite ($0.10) must not be shadowed by the shorter flash key ($0.30)
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'gemini-2.5-flash-lite')).toBe(
			DEFAULT_MODEL_PRICES['gemini-2.5-flash-lite']
		);
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'gemini-2.5-flash')).toBe(
			DEFAULT_MODEL_PRICES['gemini-2.5-flash']
		);
		// a dated/suffixed pro id still resolves to the gemini-3.1-pro base price
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'gemini-3.1-pro-preview')).toBe(
			DEFAULT_MODEL_PRICES['gemini-3.1-pro']
		);
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

	it('prices the token-billed transcribe models but leaves whisper unpriced', () => {
		// gpt-4o-transcribe reports token usage, so it has its own default price —
		// and its longer key wins over the plain gpt-4o entry.
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'gpt-4o-transcribe')).toBe(
			DEFAULT_MODEL_PRICES['gpt-4o-transcribe']
		);
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'gpt-4o-mini-transcribe')).toBe(
			DEFAULT_MODEL_PRICES['gpt-4o-mini-transcribe']
		);
		// whisper-1 is billed per audio-minute, not per token: no default price,
		// so its requests record a null cost.
		expect(resolvePrice(DEFAULT_MODEL_PRICES, 'whisper-1')).toBeNull();
	});
});
