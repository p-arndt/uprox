/**
 * Token-usage normalization across provider response shapes.
 *
 * Every provider reports usage differently — and, more importantly, disagrees on
 * whether cache tokens are *inside* the input count or *next to* it. This module
 * resolves all of them to one figure the cost calc can trust; see
 * {@link normalizeUsage}. Lives apart from gateway.ts so it can be unit-tested
 * without pulling in the database and request plumbing.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Token usage from an upstream response, normalized across provider shapes. */
export interface NormalizedUsage {
	/**
	 * Total input volume *including* any cache read/write tokens. OpenAI's
	 * `prompt_tokens` already is total; Anthropic reports cache counts separately
	 * from `input_tokens`, so we fold them in here for one consistent figure.
	 */
	input: number | null;
	output: number | null;
	/** input tokens served from the provider's prompt cache (cache read) */
	cacheRead: number | null;
	/** input tokens written to the provider's prompt cache (cache write) */
	cacheWrite: number | null;
}

/**
 * Read and normalize token usage from an upstream usage object. Spans the chat
 * shape (`prompt_tokens` + `prompt_tokens_details.{cached_tokens,cache_write_tokens}`),
 * the Responses shape (`input_tokens` + `input_tokens_details.{...}`), and
 * Anthropic's (`input_tokens` + top-level `cache_read_input_tokens` /
 * `cache_creation_input_tokens`).
 *
 * The key difference: OpenAI nests its cache counts in `*_tokens_details` as a
 * subset already counted in `prompt_tokens`, whereas Anthropic's `input_tokens`
 * *excludes* its cache counts. We resolve both to `input` = full input volume,
 * with `cacheRead` / `cacheWrite` as the cache subsets priced separately by the
 * cost calc. Cache traffic is the provider's discount on repeated input —
 * unrelated to uprox's own exact-match response cache. Returns null when no
 * usage is reported.
 */
export function normalizeUsage(usage: unknown): NormalizedUsage | null {
	if (!isRecord(usage)) return null;
	const n = (v: unknown) => (typeof v === 'number' ? v : null);
	const rawInput = n(usage.prompt_tokens) ?? n(usage.input_tokens);
	const output = n(usage.completion_tokens) ?? n(usage.output_tokens);
	const details = isRecord(usage.prompt_tokens_details)
		? usage.prompt_tokens_details
		: isRecord(usage.input_tokens_details)
			? usage.input_tokens_details
			: null;
	const detailCached = details ? n(details.cached_tokens) : null;
	// GPT-5.6+ reports cache writes alongside reads in the same details object;
	// earlier OpenAI families omit the field (their writes carry no surcharge).
	const detailWritten = details ? n(details.cache_write_tokens) : null;
	// Either details field marks the OpenAI shape, where cache tokens are already
	// part of rawInput. Anthropic reports them top-level, on top of input_tokens.
	const inputIncludesCache = detailCached != null || detailWritten != null;
	const cacheRead = detailCached ?? n(usage.cache_read_input_tokens);
	const cacheWrite = detailWritten ?? n(usage.cache_creation_input_tokens);
	const input =
		rawInput == null
			? null
			: inputIncludesCache
				? rawInput
				: rawInput + (cacheRead ?? 0) + (cacheWrite ?? 0);
	if (input == null && output == null && cacheRead == null && cacheWrite == null) return null;
	return { input, output, cacheRead, cacheWrite };
}
