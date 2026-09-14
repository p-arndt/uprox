/** The billable request pipelines: OpenAI-compatible JSON, multipart and native Gemini. */
import type { RequestEvent } from '@sveltejs/kit';
import { authHeaders, PROVIDERS, type Capability } from '$lib/server/providers';
import { getAdapter } from '$lib/server/adapters';
import { cacheKeyFor, isDeterministicRequest } from '$lib/server/cache';
import { isRecord } from '$lib/server/json';
import { geminiEnvelope, openAiEnvelope } from './envelope';
import type { GatewayAuth } from './authenticate';
import { createContext } from './context';
import { resolveRoutedProvider } from './resolve-provider';
import { acquireUpstream, checkAccess, replayCached } from './guards';
import { fetchUpstream, readUpstreamText } from './upstream';
import {
	bufferedOpenAiUsageExtractor,
	geminiNativeUsage,
	geminiUsageExtractor,
	openAiUsageExtractor,
	recordCompletion,
	usageFromText,
	type CacheTarget
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

/**
 * The core request flow: route by model → enforce policy → load the upstream
 * key → proxy to the provider → audit. Returns a Response either way.
 */
export async function proxyToProvider(event: RequestEvent, opts: ProxyOptions): Promise<Response> {
	const { auth, scope, model, path, body, stream, preferProvider, wantsUsageChunk } = opts;
	const ctx = createContext(event, auth, {
		scope,
		model,
		envelope: openAiEnvelope,
		traceRequest: body
	});
	const { token } = ctx;

	const provider = await resolveRoutedProvider(ctx, preferProvider);
	if (provider instanceof Response) return provider;

	const denied = await checkAccess(ctx, provider);
	if (denied) return denied;

	// exact-match cache: applies to chat, embeddings, and the Responses API.
	// Streaming responses are cacheable too: the SSE body is captured and replayed
	// verbatim on a hit. The cache key includes the request's `stream` flag, so a
	// streamed request only ever matches a stored SSE body and a buffered request
	// only matches stored JSON — formats never cross.
	// Caching is an instance-wide optimization, not access control: it applies even
	// to services with no policy. A policy's cacheTtlSeconds, when set (non-null),
	// overrides the instance default — including 0 to explicitly opt a policy out.
	// Note on the Responses API: a multi-turn call carries `previous_response_id`,
	// which differs every turn, so its body never collides with another turn —
	// only a byte-identical request is ever served from cache.
	const cacheTtl = token.effective.cacheTtlSeconds;
	// A Responses API call with store:false isn't persisted by OpenAI, so its
	// returned `id` can't be referenced later — don't cache/replay one.
	const responsesStoreOff = scope === 'responses' && isRecord(body) && body.store === false;
	const cacheable =
		(scope === 'chat' || scope === 'embeddings' || scope === 'responses') &&
		cacheTtl > 0 &&
		!responsesStoreOff &&
		// only cache reproducible requests: embeddings always, chat/responses only
		// when sampling is pinned (temperature 0 or an explicit seed), so two
		// identical-but-varied prompts each reach the model.
		isDeterministicRequest(scope, body);
	const cache: CacheTarget | null = cacheable
		? { key: cacheKeyFor(provider.id, path, body, token.providerSecretId), ttlSeconds: cacheTtl }
		: null;
	if (cache) {
		const hit = await replayCached(ctx, provider, cache.key, stream);
		if (hit) return hit;
	}

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	// A provider with an adapter speaks a non-OpenAI native API; it builds its own
	// URL and translates the request/response bodies. Pass-through providers send
	// the OpenAI request verbatim to `${baseUrl}${path}`.
	const adapter = getAdapter(provider.id);

	let outboundBody = body;
	// For streamed chat completions, ask the upstream to emit a final usage
	// chunk; otherwise streaming responses carry no token counts and we can't
	// compute cost. Don't clobber a caller-supplied stream_options. Adapters emit
	// their own usage chunk, so this OpenAI-only knob is skipped for them.
	if (!adapter && stream && wantsUsageChunk && isRecord(outboundBody)) {
		const existing = isRecord(outboundBody.stream_options) ? outboundBody.stream_options : {};
		outboundBody = { ...outboundBody, stream_options: { ...existing, include_usage: true } };
	}

	const upstreamUrl = adapter
		? adapter.buildUrl({ baseUrl: grant.baseUrl, scope, model, stream })
		: `${grant.baseUrl}${path}`;
	const upstreamBody = adapter ? adapter.translateRequest(scope, outboundBody) : outboundBody;

	// Realtime endpoints are gated behind `OpenAI-Beta: realtime=v1`; default it
	// when the client omitted the header, but honour a client-supplied value.
	const incomingBeta =
		event.request.headers.get('openai-beta') ?? (scope === 'realtime' ? 'realtime=v1' : null);
	const fetched = await fetchUpstream(ctx, provider, grant, upstreamUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// Forward the beta opt-in header some OpenAI endpoints require — e.g. the
			// Realtime endpoints need `OpenAI-Beta: realtime=v1`, and without it OpenAI
			// 404s the route. Only for pass-through providers; adapters speak their
			// own native API.
			...(!adapter && incomingBeta ? { 'openai-beta': incomingBeta } : {}),
			...authHeaders(provider, grant.apiKey)
		},
		body: JSON.stringify(upstreamBody)
	});
	if (!fetched.ok) return fetched.response;
	const { upstream } = fetched;

	// Streaming: the client gets the body untouched while usage is captured for
	// cost. For an adapter provider we first translate the native event stream
	// into OpenAI SSE, so both the client and the usage capture see that shape.
	if (stream && upstream.ok && upstream.body) {
		return streamWithRecording(ctx, {
			provider,
			upstream,
			source: adapter ? adapter.translateStream({ model }, upstream.body) : upstream.body,
			extract: openAiUsageExtractor,
			cache,
			detail: 'stream',
			release: grant.release
		});
	}

	// Buffered: translate (for adapter providers) then parse usage for cost. After
	// translation the body is OpenAI-shaped, so usage parsing, caching and the
	// returned payload all use the same code path as pass-through.
	const rawText = await readUpstreamText(ctx, provider, grant, upstream);
	if (rawText instanceof Response) return rawText;
	const text = adapter
		? adapter.translateResponse({ scope, model, text: rawText, ok: upstream.ok })
		: rawText;
	await recordCompletion(ctx, {
		provider,
		statusCode: upstream.status,
		ok: upstream.ok,
		usage: usageFromText(text, bufferedOpenAiUsageExtractor),
		response: text,
		format: 'json',
		cache,
		complete: true,
		release: grant.release
	});

	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': 'application/json',
			...(cache ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}

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
	const { auth, scope, model, method, stream, body } = opts;
	const provider = PROVIDERS.gemini;

	// defense-in-depth: `model` is interpolated raw into the upstream URL below, so
	// reject anything outside a safe model-name charset before it gets there.
	if (model && !SAFE_MODEL_NAME.test(model)) {
		return geminiEnvelope.error(400, 'Invalid model name', 'invalid_request');
	}

	const ctx = createContext(event, auth, {
		scope,
		model,
		envelope: geminiEnvelope,
		traceRequest: body
	});
	const { token } = ctx;

	const denied = await checkAccess(ctx, provider);
	if (denied) return denied;

	// exact-match cache. Determinism for native bodies: embeddings always;
	// generateContent only when sampling is pinned (generationConfig.temperature 0).
	const cacheTtl = token.effective.cacheTtlSeconds;
	const genCfg = isRecord(body) && isRecord(body.generationConfig) ? body.generationConfig : null;
	const deterministic = scope === 'embeddings' || (genCfg != null && genCfg.temperature === 0);
	const cacheable = (scope === 'chat' || scope === 'embeddings') && cacheTtl > 0 && deterministic;
	// Key on the native path + body; distinct from the OpenAI-ingress cache (which
	// keys on `/chat/completions` + an OpenAI body), so formats never cross.
	const cachePath = `/models/${model}:${method}`;
	const cache: CacheTarget | null = cacheable
		? {
				key: cacheKeyFor(provider.id, cachePath, body, token.providerSecretId),
				ttlSeconds: cacheTtl
			}
		: null;
	if (cache) {
		const hit = await replayCached(ctx, provider, cache.key, stream, 'native ');
		if (hit) return hit;
	}

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	// Forward the query string verbatim except `key` — the Google SDK may put the
	// API key there, and that's the uprox token, which must never reach Google.
	const search = new URLSearchParams(event.url.search);
	search.delete('key');
	const qs = search.toString();
	const upstreamUrl = `${grant.baseUrl}/models/${model}:${method}${qs ? `?${qs}` : ''}`;

	const fetched = await fetchUpstream(ctx, provider, grant, upstreamUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...authHeaders(provider, grant.apiKey)
		},
		body: JSON.stringify(body)
	});
	if (!fetched.ok) return fetched.response;
	const { upstream } = fetched;

	// streaming passthrough: the client gets the native SSE untouched while the
	// native usageMetadata is captured so we can still bill it.
	if (stream && upstream.ok && upstream.body) {
		return streamWithRecording(ctx, {
			provider,
			upstream,
			source: upstream.body,
			extract: geminiUsageExtractor,
			cache,
			detail: 'native stream',
			release: grant.release
		});
	}

	// buffered passthrough: read native usageMetadata for cost, return body as-is.
	const text = await readUpstreamText(ctx, provider, grant, upstream);
	if (text instanceof Response) return text;
	await recordCompletion(ctx, {
		provider,
		statusCode: upstream.status,
		ok: upstream.ok,
		usage: usageFromText(text, geminiNativeUsage),
		response: text,
		format: 'json',
		detail: 'native',
		cache,
		complete: true,
		release: grant.release
	});

	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/json',
			...(cache ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}
