/**
 * Provider adapters: the translation seam that lets the gateway reach upstreams
 * whose API is *not* OpenAI-compatible (e.g. Google Gemini's native
 * `generateContent` API). A provider with no adapter is proxied verbatim — the
 * gateway sends the OpenAI-shaped request straight through, as it always has.
 *
 * An adapter's job is to make a native upstream look OpenAI-compatible to the
 * rest of the gateway: it rewrites the request URL and body on the way out and
 * the response (buffered JSON, SSE stream, and model list) on the way back into
 * the OpenAI shapes that cost tracking, caching, and clients already understand.
 * Because translation produces standard OpenAI payloads, everything downstream
 * (usage normalization, response caching, audit) keeps working unchanged.
 */
import type { Capability } from '$lib/scopes';

/** A model id as it appears in an OpenAI-style model listing. */
export interface AdapterModel {
	id: string;
}

export interface ProviderAdapter {
	/**
	 * The full upstream URL for a request. Native APIs put the model and the
	 * operation in the path (e.g. `/models/{model}:generateContent`), so this
	 * replaces the `baseUrl + path` concatenation used for pass-through providers.
	 */
	buildUrl(opts: { baseUrl: string; scope: Capability; model: string; stream: boolean }): string;
	/** Translate an OpenAI-shaped request body into the provider-native body. */
	translateRequest(scope: Capability, body: unknown): unknown;
	/**
	 * Translate a buffered native response into an OpenAI-shaped JSON string.
	 * `ok` is the upstream HTTP success flag: on a non-2xx the native error body
	 * is rewrapped in an OpenAI error envelope so SDK clients parse it correctly.
	 */
	translateResponse(opts: { scope: Capability; model: string; text: string; ok: boolean }): string;
	/**
	 * Wrap a native streaming response body, emitting OpenAI-compatible
	 * `chat.completion.chunk` SSE (including a trailing usage chunk and `[DONE]`),
	 * so the gateway's existing SSE drain captures usage and clients see the
	 * familiar shape.
	 */
	translateStream(
		opts: { model: string },
		body: ReadableStream<Uint8Array>
	): ReadableStream<Uint8Array>;
	/** The native model-listing URL. */
	modelsUrl(baseUrl: string): string;
	/** Translate a native model-list response into OpenAI-style model ids. */
	translateModels(text: string): AdapterModel[];
}
