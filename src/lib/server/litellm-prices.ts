/**
 * Pure mapper from LiteLLM's public price list
 * (https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)
 * into this project's per-1M-token price map. No I/O: the caller fetches the
 * JSON and decides what to do with the result (e.g. diff it against the seeded
 * defaults with {@link diffAgainst}).
 *
 * The input is untrusted: anything that isn't a plain object with finite
 * numeric costs is skipped rather than thrown on.
 */
import { PROVIDERS, type ModelPrice } from '$lib/server/providers';

/**
 * A mapped price. `longMinPromptTokens` is the INCLUSIVE minimum prompt size at
 * which the long card applies (unset = the shared 272_000 default). Declared
 * here so this module compiles whether or not ModelPrice carries it yet.
 */
export type LiteLLMPrice = ModelPrice & { longMinPromptTokens?: number };

/** One field that differs between a base price and a fetched one. */
export interface PriceDiff {
	model: string;
	field: PriceField;
	base: number | undefined;
	fetched: number | undefined;
}

export interface PriceDiffResult {
	diffs: PriceDiff[];
	/** base keys that have no entry in the fetched map */
	missing: string[];
}

type PriceField = keyof LiteLLMPrice;

const PRICE_FIELDS: PriceField[] = [
	'in',
	'out',
	'cacheRead',
	'cacheWrite',
	'longIn',
	'longOut',
	'longCacheRead',
	'longCacheWrite',
	'longMinPromptTokens'
];

/** LiteLLM `litellm_provider` values we map, and the registry provider each feeds. */
const PROVIDER_IDS = ['openai', 'anthropic', 'gemini'] as const;
type ProviderId = (typeof PROVIDER_IDS)[number];

/** LiteLLM `mode` values that are token-billed on a surface we proxy. */
const MODES = new Set(['chat', 'responses', 'embedding', 'image_generation']);

/** Raw-key prefixes LiteLLM uses to namespace a provider's models. */
const KEY_PREFIXES = ['openai/', 'anthropic/', 'gemini/'];

/** Cross-region / deployment variants (Bedrock-style `us.` etc.). */
const REGION_PREFIX = /^(us|eu|apac|ap|global|jp|au|ca)\./;

/** `input_cost_per_token_above_<N>k_tokens` — exact, no tier suffixes. */
const LONG_INPUT_FIELD = /^input_cost_per_token_above_(\d+)k_tokens$/;

function round4(n: number): number {
	return Math.round(n * 1e4) / 1e4;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A per-token cost as a per-1M rate, or undefined when absent/garbage/negative. */
function perMillion(entry: Record<string, unknown>, field: string): number | undefined {
	const v = entry[field];
	if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
	return round4(v * 1e6);
}

/** Normalised key, or null when the raw key is a variant we don't price. */
function normaliseKey(rawKey: string, provider: ProviderId): string | null {
	let key = rawKey.toLowerCase();
	const prefix = KEY_PREFIXES.find((p) => key.startsWith(p));
	if (prefix) key = key.slice(prefix.length);
	if (!key || key.includes('/') || key.includes(':') || REGION_PREFIX.test(key)) return null;
	// the key must route to the same provider LiteLLM files it under
	if (!PROVIDERS[provider].modelPrefixes.some((p) => key.startsWith(p))) return null;
	return key;
}

/** Lowest `above_<N>k_tokens` threshold that has an input rate, in thousands. */
function lowestLongThreshold(entry: Record<string, unknown>): number | undefined {
	let lowest: number | undefined;
	for (const field of Object.keys(entry)) {
		const m = LONG_INPUT_FIELD.exec(field);
		if (!m) continue;
		const n = Number(m[1]);
		if (n > 0 && perMillion(entry, field) !== undefined && (lowest === undefined || n < lowest))
			lowest = n;
	}
	return lowest;
}

function mapEntry(entry: Record<string, unknown>, provider: ProviderId): LiteLLMPrice | null {
	const mode = entry.mode as string;
	const input = perMillion(entry, 'input_cost_per_token');
	if (input === undefined || input <= 0) return null;

	const embedding = mode === 'embedding';
	// gpt-image-* bill image output by the image-token rate; `output_cost_per_token`
	// (when present at all) is the cheaper text-output rate.
	const out =
		mode === 'image_generation'
			? (perMillion(entry, 'output_cost_per_image_token') ??
				perMillion(entry, 'output_cost_per_token'))
			: perMillion(entry, 'output_cost_per_token');
	if (out === undefined) {
		if (!embedding) return null;
	}

	const price: LiteLLMPrice = { in: input, out: out ?? 0 };
	// Embeddings have no prompt caching: leave both cache rates unset.
	if (embedding) return price;

	// Anthropic: an unset rate falls back to 0.1× / 1.25× in costFromPrice, which
	// is exactly Anthropic's ratio. OpenAI/Gemini: a missing rate means no
	// discount / no surcharge, i.e. the plain input rate.
	const anthropic = provider === 'anthropic';
	const cacheRead = perMillion(entry, 'cache_read_input_token_cost');
	const cacheWrite = perMillion(entry, 'cache_creation_input_token_cost');
	if (cacheRead !== undefined) price.cacheRead = cacheRead;
	else if (!anthropic) price.cacheRead = input;
	if (cacheWrite !== undefined) price.cacheWrite = cacheWrite;
	else if (!anthropic) price.cacheWrite = input;

	// Long-context card. LiteLLM's "above N k" is exclusive; our minimum is
	// inclusive, hence +1. If several thresholds exist we take the lowest: our
	// price model holds a single long card, and the first step up is the one
	// most requests hit.
	const n = lowestLongThreshold(entry);
	if (n !== undefined) {
		const suffix = `_above_${n}k_tokens`;
		const longIn = perMillion(entry, `input_cost_per_token${suffix}`)!;
		price.longIn = longIn;
		price.longOut = perMillion(entry, `output_cost_per_token${suffix}`) ?? price.out;
		const longRead = perMillion(entry, `cache_read_input_token_cost${suffix}`);
		const longWrite = perMillion(entry, `cache_creation_input_token_cost${suffix}`);
		// Unlike the standard card, an unset long cache rate would fall back to a
		// multiple of longIn — right for Anthropic, an overcharge for the others.
		if (longRead !== undefined) price.longCacheRead = longRead;
		else if (!anthropic) price.longCacheRead = longIn;
		if (longWrite !== undefined) price.longCacheWrite = longWrite;
		else if (!anthropic) price.longCacheWrite = longIn;
		price.longMinPromptTokens = n * 1000 + 1;
	}
	return price;
}

/**
 * Map LiteLLM's price list to `{ [modelKey]: LiteLLMPrice }` (USD per 1M tokens).
 *
 * Keeps only `litellm_provider` openai / anthropic / gemini in modes chat,
 * responses, embedding and image_generation, with a positive per-token input
 * rate. Keys are lower-cased and stripped of `openai/`, `anthropic/`,
 * `gemini/`; keys still containing `/` or `:` (fine-tunes, per-size image SKUs),
 * region variants, and keys outside the provider's routing prefixes are
 * dropped, since every extra key shifts longest-prefix resolution. When two raw
 * keys normalise to the same key the un-prefixed one wins (then the
 * lexicographically smaller raw key). Garbage input yields `{}`.
 */
export function parseLiteLLMPrices(json: unknown): Record<string, LiteLLMPrice> {
	if (!isRecord(json)) return {};
	const chosen = new Map<string, { raw: string; price: LiteLLMPrice }>();
	for (const [raw, entry] of Object.entries(json)) {
		if (raw === 'sample_spec' || !isRecord(entry)) continue;
		const provider = entry.litellm_provider;
		if (typeof provider !== 'string' || !(PROVIDER_IDS as readonly string[]).includes(provider))
			continue;
		if (typeof entry.mode !== 'string' || !MODES.has(entry.mode)) continue;
		const key = normaliseKey(raw, provider as ProviderId);
		if (!key) continue;
		const price = mapEntry(entry, provider as ProviderId);
		if (!price) continue;
		const prev = chosen.get(key);
		if (!prev || preferRaw(raw, prev.raw, key)) chosen.set(key, { raw, price });
	}
	const result: Record<string, LiteLLMPrice> = {};
	for (const key of [...chosen.keys()].sort()) result[key] = chosen.get(key)!.price;
	return result;
}

/** Whether raw key `a` should beat `b` for the same normalised key. */
function preferRaw(a: string, b: string, key: string): boolean {
	const aExact = a === key;
	const bExact = b === key;
	if (aExact !== bExact) return aExact;
	const aPrefixed = a.includes('/');
	const bPrefixed = b.includes('/');
	if (aPrefixed !== bPrefixed) return !aPrefixed;
	return a < b;
}

/**
 * Field-by-field differences between a base price map and a fetched one, for
 * keys present in both (an unset field vs a set one counts as a difference),
 * plus the base keys the fetched map lacks.
 */
export function diffAgainst(
	base: Record<string, ModelPrice>,
	fetched: Record<string, LiteLLMPrice>
): PriceDiffResult {
	const diffs: PriceDiff[] = [];
	const missing: string[] = [];
	for (const model of Object.keys(base)) {
		const f = Object.hasOwn(fetched, model) ? fetched[model] : undefined;
		if (!f) {
			missing.push(model);
			continue;
		}
		const b = base[model] as LiteLLMPrice;
		for (const field of PRICE_FIELDS) {
			if (b[field] !== f[field]) diffs.push({ model, field, base: b[field], fetched: f[field] });
		}
	}
	return { diffs, missing };
}
