/**
 * The billable request pipelines: OpenAI-compatible JSON, multipart and native
 * Gemini. The JSON and native pipelines run the same stages over a shared
 * {@link RequestContext}: resolve the provider → guard (capability, policy, rate
 * limit) and replay the exact-match cache → acquire the upstream (budget,
 * credentials) → send → record (stream or buffered).
 */
import type { RequestEvent } from '@sveltejs/kit';
import { authHeaders, PROVIDERS, type Capability, type ProviderDef } from '$lib/server/providers';
import { getAdapter, type ProviderAdapter } from '$lib/server/adapters';
import { cacheKeyFor, isDeterministicRequest } from '$lib/server/cache';
import { isRecord } from '$lib/server/json';
import { geminiEnvelope, openAiEnvelope } from './envelope';
import type { GatewayAuth } from './authenticate';
import { createContext, type RequestContext } from './context';
import { resolveRoutedProvider } from './resolve-provider';
import { acquireUpstream, checkAccess, replayCached, type UpstreamGrant } from './guards';
import { fetchUpstream, readUpstreamText } from './upstream';
import {
	bufferedOpenAiUsageExtractor,
	geminiNativeUsage,
	geminiUsageExtractor,
	openAiUsageExtractor,
	recordCompletion,
	usageFromText,
	type CacheTarget,
	type UsageExtractor
} from './record-usage';
import { streamWithRecording } from './stream';

export interface ProxyOptions {
	auth: GatewayAuth;
	/** the gateway capability this request exercises (also the policy scope) */
	scope: Capability;
	model: string;
	/** upstream path appended to the provider base url, e.g. "/chat/completions" */
	path: string;
	body: unknown;
	stream: boolean;
	/**
	 * Ask a pass-through upstream to append a usage chunk to a streamed response
	 * (`stream_options.include_usage`), so streamed chat completions can be
	 * costed. Set by the chat-completions endpoint descriptor.
	 */
	wantsUsageChunk?: boolean;
	/**
	 * Override the provider routed to when both OpenAI and Azure are configured.
	 * Set from Azure-style URL routes (`/openai/deployments/…`, `/openai/v1/…`)
	 * so URL-level intent beats the policy's preferredProvider. Optional.
	 */
	preferProvider?: string;
}

/* ------------------------------ shared stages ------------------------------ */

/** A completed upstream exchange, carried into the record stage. */
interface Exchange {
	provider: ProviderDef;
	grant: UpstreamGrant;
	upstream: Response;
	cache: CacheTarget | null;
}

/**
 * Guard stage: capability, policy and rate limit, then the exact-match cache. A
 * hit is free (no key, no upstream call, no spend), so it runs before the budget
 * gate in {@link acquireUpstream}. Returns the response that ends the request —
 * an audited rejection or a cache replay — or null to continue.
 */
async function guardAndReplay(
	ctx: RequestContext,
	provider: ProviderDef,
	cache: CacheTarget | null,
	replay: (cacheKey: string) => Promise<Response | null>
): Promise<Response | null> {
	const denied = await checkAccess(ctx, provider);
	if (denied) return denied;
	return cache ? replay(cache.key) : null;
}

/** The upstream body to stream to the client, or null when the response is buffered. */
function streamBody(stream: boolean, upstream: Response): ReadableStream<Uint8Array> | null {
	return stream && upstream.ok ? upstream.body : null;
}

/** Record stage (streamed): hand the body to the client while usage is captured in-line. */
function recordStream(
	ctx: RequestContext,
	x: Exchange,
	stream: { source: ReadableStream<Uint8Array>; extract: UsageExtractor; detail: string }
): Response {
	return streamWithRecording(ctx, {
		provider: x.provider,
		upstream: x.upstream,
		source: stream.source,
		extract: stream.extract,
		cache: x.cache,
		detail: stream.detail,
		release: x.grant.release
	});
}

interface BufferedRecording {
	/** turn the raw upstream body into the body the client receives */
	translate: (raw: string) => string;
	extract: UsageExtractor;
	detail?: string;
	contentType: string;
}

/** Record stage (buffered): read the body, record usage and cost, answer the client. */
async function recordBuffered(
	ctx: RequestContext,
	x: Exchange,
	opts: BufferedRecording
): Promise<Response> {
	const rawText = await readUpstreamText(ctx, x.provider, x.grant, x.upstream);
	if (rawText instanceof Response) return rawText;
	const text = opts.translate(rawText);
	await recordCompletion(ctx, {
		provider: x.provider,
		statusCode: x.upstream.status,
		ok: x.upstream.ok,
		usage: usageFromText(text, opts.extract),
		response: text,
		format: 'json',
		...(opts.detail ? { detail: opts.detail } : {}),
		cache: x.cache,
		complete: true,
		release: x.grant.release
	});
	return new Response(text, {
		status: x.upstream.status,
		headers: {
			'content-type': opts.contentType,
			...(x.cache ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}

/* ------------------------- OpenAI-compatible pipeline ------------------------- */

const CACHEABLE_SCOPES: ReadonlySet<Capability> = new Set(['chat', 'embeddings', 'responses']);

/**
 * Exact-match cache target for an OpenAI-shaped request, or null when it isn't
 * cacheable. Applies to chat, embeddings and the Responses API. Streaming
 * responses are cacheable too: the SSE body is captured and replayed verbatim on
 * a hit. The key includes the request's `stream` flag, so a streamed request
 * only ever matches a stored SSE body and a buffered one only stored JSON.
 *
 * Caching is an instance-wide optimization, not access control: it applies even
 * to services with no policy. A policy's cacheTtlSeconds, when set (non-null),
 * overrides the instance default — including 0 to explicitly opt a policy out.
 * A multi-turn Responses call carries `previous_response_id`, which differs every
 * turn, so only a byte-identical request is ever served from cache.
 */
function openAiCacheTarget(
	ctx: RequestContext,
	provider: ProviderDef,
	opts: ProxyOptions
): CacheTarget | null {
	const { scope, body } = opts;
	const ttlSeconds = ctx.token.effective.cacheTtlSeconds;
	if (!CACHEABLE_SCOPES.has(scope) || !(ttlSeconds > 0)) return null;
	// A Responses API call with store:false isn't persisted by OpenAI, so its
	// returned `id` can't be referenced later — don't cache/replay one.
	if (scope === 'responses' && isRecord(body) && body.store === false) return null;
	// only cache reproducible requests: embeddings always, chat/responses only
	// when sampling is pinned (temperature 0 or an explicit seed), so two
	// identical-but-varied prompts each reach the model.
	if (!isDeterministicRequest(scope, body)) return null;
	return {
		key: cacheKeyFor(provider.id, opts.path, body, ctx.token.providerSecretId),
		ttlSeconds
	};
}

/**
 * For streamed chat completions, ask a pass-through upstream to emit a final
 * usage chunk; otherwise streaming responses carry no token counts and we can't
 * compute cost. A caller-supplied stream_options is kept.
 */
function withUsageChunk(body: unknown, wanted: boolean): unknown {
	if (!wanted || !isRecord(body)) return body;
	const existing = isRecord(body.stream_options) ? body.stream_options : {};
	return { ...body, stream_options: { ...existing, include_usage: true } };
}

/**
 * Forward the beta opt-in header some OpenAI endpoints require — e.g. the
 * Realtime endpoints need `OpenAI-Beta: realtime=v1`, and without it OpenAI 404s
 * the route. Defaults it for realtime when the client omitted it, but honours a
 * client-supplied value. Only for pass-through providers; adapters speak their
 * own native API.
 */
function openAiBetaHeader(
	event: RequestEvent,
	scope: Capability,
	adapter: ProviderAdapter | null
): Record<string, string> {
	if (adapter) return {};
	const beta =
		event.request.headers.get('openai-beta') ?? (scope === 'realtime' ? 'realtime=v1' : null);
	return beta ? { 'openai-beta': beta } : {};
}

/**
 * Send stage request for the OpenAI-compatible surface. A provider with an
 * adapter speaks a non-OpenAI native API: it builds its own URL and translates
 * the body (adapters emit their own usage chunk, so the OpenAI-only
 * `include_usage` knob is skipped for them). Pass-through providers get the
 * OpenAI request verbatim at `${baseUrl}${path}`.
 */
function openAiUpstreamRequest(
	event: RequestEvent,
	opts: ProxyOptions,
	provider: ProviderDef,
	grant: UpstreamGrant,
	adapter: ProviderAdapter | null
): { url: string; init: RequestInit } {
	const { scope, model, stream } = opts;
	const url = adapter
		? adapter.buildUrl({ baseUrl: grant.baseUrl, scope, model, stream })
		: `${grant.baseUrl}${opts.path}`;
	const body = adapter
		? adapter.translateRequest(scope, opts.body)
		: withUsageChunk(opts.body, stream && Boolean(opts.wantsUsageChunk));
	return {
		url,
		init: {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...openAiBetaHeader(event, scope, adapter),
				...authHeaders(provider, grant.apiKey)
			},
			body: JSON.stringify(body)
		}
	};
}

/**
 * The core request flow: route by model → enforce policy → load the upstream
 * key → proxy to the provider → audit. Returns a Response either way.
 */
export async function proxyToProvider(event: RequestEvent, opts: ProxyOptions): Promise<Response> {
	const { scope, model } = opts;
	const ctx = createContext(event, opts.auth, {
		scope,
		model,
		envelope: openAiEnvelope,
		traceRequest: opts.body
	});

	const provider = await resolveRoutedProvider(ctx, opts.preferProvider);
	if (provider instanceof Response) return provider;

	const cache = openAiCacheTarget(ctx, provider, opts);
	const blocked = await guardAndReplay(ctx, provider, cache, (key) =>
		replayCached(ctx, provider, key, opts.stream)
	);
	if (blocked) return blocked;

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	const adapter = getAdapter(provider.id);
	const { url, init } = openAiUpstreamRequest(event, opts, provider, grant, adapter);
	const fetched = await fetchUpstream(ctx, provider, grant, url, init);
	if (!fetched.ok) return fetched.response;
	const x: Exchange = { provider, grant, upstream: fetched.upstream, cache };

	// Streaming: the client gets the body untouched while usage is captured for
	// cost. For an adapter provider the native event stream is first translated
	// into OpenAI SSE, so both the client and the usage capture see that shape.
	const body = streamBody(opts.stream, x.upstream);
	if (body) {
		const source = adapter ? adapter.translateStream({ model }, body) : body;
		return recordStream(ctx, x, { source, extract: openAiUsageExtractor, detail: 'stream' });
	}

	// Buffered: translate (for adapter providers) then parse usage for cost. After
	// translation the body is OpenAI-shaped, so usage parsing, caching and the
	// returned payload all use the same code path as pass-through.
	const { ok } = x.upstream;
	return recordBuffered(ctx, x, {
		translate: (text) => (adapter ? adapter.translateResponse({ scope, model, text, ok }) : text),
		extract: bufferedOpenAiUsageExtractor,
		contentType: 'application/json'
	});
}

/* ----------------------------- multipart pipeline ----------------------------- */

export interface MultipartProxyOptions {
	auth: GatewayAuth;
	/** the gateway capability this request exercises (also the policy scope) */
	scope: Capability;
	model: string;
	/** upstream path appended to the provider base url, e.g. "/audio/transcriptions" */
	path: string;
	/** the multipart form to forward; `fetch` sets its own content-type + boundary */
	form: FormData;
	/** override the routed provider when both OpenAI and Azure are configured */
	preferProvider?: string;
}

/**
 * Model-routed proxy for endpoints whose request body is multipart/form-data —
 * audio transcriptions and image edits. It shares the JSON path's cross-cutting
 * concerns (route by model → capability check → policy → rate limit → budget →
 * audit), but forwards a rebuilt {@link FormData} instead of a JSON body, so the
 * uploaded bytes survive with their boundary intact. No caching or streaming: a
 * transcription isn't a deterministic, replayable request. Cost is best-effort —
 * token-billed models (gpt-4o-transcribe, gpt-image-1) report usage and are
 * priced; whisper-1 reports none and records a null cost.
 */
export async function proxyMultipartToProvider(
	event: RequestEvent,
	opts: MultipartProxyOptions
): Promise<Response> {
	const { auth, scope, model, path, form, preferProvider } = opts;
	// never store the raw multipart body (binary audio/images) on the trace —
	// record a compact request summary instead
	const ctx = createContext(event, auth, {
		scope,
		model,
		envelope: openAiEnvelope,
		traceRequest: { endpoint: path, model }
	});

	const provider = await resolveRoutedProvider(ctx, preferProvider);
	if (provider instanceof Response) return provider;

	const denied = await checkAccess(ctx, provider);
	if (denied) return denied;

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	// Forward the query string (Azure's ?api-version=… etc.) verbatim. Do NOT set
	// content-type: fetch derives the multipart boundary from the FormData body.
	const upstreamUrl = `${grant.baseUrl}${path}${event.url.search}`;
	const fetched = await fetchUpstream(ctx, provider, grant, upstreamUrl, {
		method: 'POST',
		headers: authHeaders(provider, grant.apiKey),
		body: form
	});
	if (!fetched.ok) return fetched.response;
	const { upstream } = fetched;

	// Buffer the response and parse usage best-effort. Transcriptions may return
	// JSON (`response_format=json|verbose_json`) or plain text (`text|srt|vtt`);
	// the latter simply yields no usage and a null cost.
	const text = await readUpstreamText(ctx, provider, grant, upstream);
	if (text instanceof Response) return text;
	await recordCompletion(ctx, {
		provider,
		statusCode: upstream.status,
		ok: upstream.ok,
		usage: usageFromText(text, bufferedOpenAiUsageExtractor),
		response: text,
		cache: null,
		complete: true,
		release: grant.release
	});

	// Preserve the upstream content-type (json vs text/plain for srt/vtt).
	const outCt = upstream.headers.get('content-type') ?? 'application/json';
	return new Response(text, { status: upstream.status, headers: { 'content-type': outCt } });
}

/* --------------------------- native Gemini pipeline --------------------------- */

export interface NativeGeminiOptions {
	auth: GatewayAuth;
	/** the gateway capability this request exercises (chat or embeddings) */
	scope: Capability;
	model: string;
	/** native method: generateContent | streamGenerateContent | embedContent | batchEmbedContents */
	method: string;
	stream: boolean;
	body: unknown;
}

/** Model names that are safe to interpolate into an upstream URL path. */
export const SAFE_MODEL_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * The request's query string, forwarded verbatim except `key` — the Google SDK
 * may put the API key there, and that's the uprox token, which must never reach
 * Google. Returns '' or `?…`.
 */
export function queryWithoutKey(url: URL): string {
	const search = new URLSearchParams(url.search);
	search.delete('key');
	const qs = search.toString();
	return qs ? `?${qs}` : '';
}

/**
 * Exact-match cache target for a native Gemini request. Determinism for native
 * bodies: embeddings always; generateContent only when sampling is pinned
 * (generationConfig.temperature 0). Keyed on the native path + body, distinct
 * from the OpenAI-ingress cache (which keys on `/chat/completions` + an OpenAI
 * body), so formats never cross.
 */
function nativeCacheTarget(
	ctx: RequestContext,
	provider: ProviderDef,
	opts: NativeGeminiOptions
): CacheTarget | null {
	const { scope, body } = opts;
	const ttlSeconds = ctx.token.effective.cacheTtlSeconds;
	if ((scope !== 'chat' && scope !== 'embeddings') || !(ttlSeconds > 0)) return null;
	const genCfg = isRecord(body) && isRecord(body.generationConfig) ? body.generationConfig : null;
	if (scope !== 'embeddings' && genCfg?.temperature !== 0) return null;
	const cachePath = `/models/${opts.model}:${opts.method}`;
	return {
		key: cacheKeyFor(provider.id, cachePath, body, ctx.token.providerSecretId),
		ttlSeconds
	};
}

/**
 * Native-ingress sibling of {@link proxyToProvider}. Accepts a request shaped for
 * Google's native Gemini REST API (sent by the `@google/genai` SDK pointed at
 * uprox) and forwards it to Gemini **verbatim** — no translation, so native-only
 * features (safety settings, thinking config, response schemas, cached content)
 * pass through with full fidelity. uprox's cross-cutting concerns still apply:
 * policy, rate limiting, budget, exact-match caching, cost accounting from the
 * native `usageMetadata`, and audit. Errors are returned in the native shape so
 * the Google SDK parses them. Routing is fixed to the Gemini provider — this
 * endpoint is the native Gemini API, not a model-routed surface.
 */
export async function proxyGeminiNative(
	event: RequestEvent,
	opts: NativeGeminiOptions
): Promise<Response> {
	const { scope, model, method, stream, body } = opts;
	const provider = PROVIDERS.gemini;

	// defense-in-depth: `model` is interpolated raw into the upstream URL below, so
	// reject anything outside a safe model-name charset before it gets there.
	if (model && !SAFE_MODEL_NAME.test(model)) {
		return geminiEnvelope.error(400, 'Invalid model name', 'invalid_request');
	}

	const ctx = createContext(event, opts.auth, {
		scope,
		model,
		envelope: geminiEnvelope,
		traceRequest: body
	});

	const cache = nativeCacheTarget(ctx, provider, opts);
	const blocked = await guardAndReplay(ctx, provider, cache, (key) =>
		replayCached(ctx, provider, key, stream, 'native ')
	);
	if (blocked) return blocked;

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	const url = `${grant.baseUrl}/models/${model}:${method}${queryWithoutKey(event.url)}`;
	const fetched = await fetchUpstream(ctx, provider, grant, url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...authHeaders(provider, grant.apiKey)
		},
		body: JSON.stringify(body)
	});
	if (!fetched.ok) return fetched.response;
	const x: Exchange = { provider, grant, upstream: fetched.upstream, cache };

	// streaming passthrough: the client gets the native SSE untouched while the
	// native usageMetadata is captured so we can still bill it.
	const source = streamBody(stream, x.upstream);
	if (source) {
		return recordStream(ctx, x, { source, extract: geminiUsageExtractor, detail: 'native stream' });
	}

	// buffered passthrough: read native usageMetadata for cost, return body as-is.
	return recordBuffered(ctx, x, {
		translate: (text) => text,
		extract: geminiNativeUsage,
		detail: 'native',
		contentType: x.upstream.headers.get('content-type') ?? 'application/json'
	});
}
