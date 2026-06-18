import { json, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { providerSecret } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { resolveToken, type ResolvedToken } from '$lib/server/tokens';
import { evaluatePolicy } from '$lib/server/policy';
import {
	providerForModel,
	resolveProvider,
	providerSupports,
	resolveBaseUrl,
	authHeaders,
	selectProviderSecret,
	PROVIDERS,
	type Capability,
	type ProviderDef
} from '$lib/server/providers';
import { getAdapter } from '$lib/server/adapters';
import { mapUsage } from '$lib/server/adapters/gemini';
import { audit, type AuditEntry } from '$lib/server/audit';
import { recordTrace } from '$lib/server/trace';
import { parseTraceparent, parseTraceMetadata } from '$lib/trace';
import { checkRateLimit } from '$lib/server/ratelimit';
import { checkBudget, reserve } from '$lib/server/budget';
import { maybeSendBudgetAlert } from '$lib/server/budget-alerts';
import { cacheKeyFor, getCached, putCached, isDeterministicRequest } from '$lib/server/cache';

/** OpenAI-style error envelope, so OpenAI SDK clients parse it correctly. */
export function gatewayError(status: number, message: string, type = 'invalid_request_error') {
	return json({ error: { message, type, code: null, param: null } }, { status });
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Token usage from an upstream response, normalized across provider shapes. */
interface NormalizedUsage {
	/**
	 * Total input volume *including* any cache read/write tokens. OpenAI's
	 * `prompt_tokens` already is total; Anthropic reports cache counts separately
	 * from `input_tokens`, so we fold them in here for one consistent figure.
	 */
	input: number | null;
	output: number | null;
	/** input tokens served from the provider's prompt cache (cache read) */
	cacheRead: number | null;
	/** input tokens written to the provider's prompt cache (Anthropic only) */
	cacheWrite: number | null;
}

/**
 * Read and normalize token usage from an upstream usage object. Spans the chat
 * shape (`prompt_tokens` + `prompt_tokens_details.cached_tokens`), the Responses
 * shape (`input_tokens` + `input_tokens_details.cached_tokens`), and Anthropic's
 * (`input_tokens` + top-level `cache_read_input_tokens` / `cache_creation_input_tokens`).
 *
 * The key difference: OpenAI's cached tokens are a subset already counted in
 * `prompt_tokens`, whereas Anthropic's `input_tokens` *excludes* its cache
 * counts. We resolve both to `input` = full input volume, with `cacheRead` /
 * `cacheWrite` as the cache subsets priced separately by the cost calc. Cache
 * traffic is the provider's discount on repeated input — unrelated to uprox's
 * own exact-match response cache. Returns null when no usage is reported.
 */
function normalizeUsage(usage: unknown): NormalizedUsage | null {
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
	// OpenAI nests cached tokens in *_tokens_details (already in rawInput);
	// Anthropic reports them top-level, separate from input_tokens.
	const inputIncludesCache = detailCached != null;
	const cacheRead = detailCached ?? n(usage.cache_read_input_tokens);
	const cacheWrite = n(usage.cache_creation_input_tokens);
	const input =
		rawInput == null
			? null
			: inputIncludesCache
				? rawInput
				: rawInput + (cacheRead ?? 0) + (cacheWrite ?? 0);
	if (input == null && output == null && cacheRead == null && cacheWrite == null) return null;
	return { input, output, cacheRead, cacheWrite };
}

/**
 * Normalize usage from a *native* Gemini response (buffered or a streamed
 * chunk). `mapUsage` converts Gemini's `usageMetadata` into the OpenAI usage
 * shape, which `normalizeUsage` then folds into the gateway's common figure — so
 * native-ingress requests are costed by the exact same code as everything else.
 */
function geminiNativeUsage(parsed: unknown): NormalizedUsage | null {
	if (!isRecord(parsed)) return null;
	const usageObj = mapUsage(parsed.usageMetadata);
	return usageObj ? normalizeUsage(usageObj) : null;
}

interface DrainedSse {
	usage: NormalizedUsage | null;
	/** the verbatim SSE body, reassembled — used to cache a streamed response */
	raw: string;
	/** false if the stream errored/aborted before completing (don't cache) */
	complete: boolean;
}

/**
 * Pull a usage figure out of one decoded SSE chunk, or null if it carries none.
 * The OpenAI extractor reads the chat shape (`{ usage }`) and the Responses
 * shape (`{ response: { usage } }`); the native Gemini extractor reads
 * `{ usageMetadata }`. Whichever the stream uses, the drain below keeps the last
 * one seen.
 */
type UsageExtractor = (obj: Record<string, unknown>) => NormalizedUsage | null;

const openAiUsageExtractor: UsageExtractor = (obj) => {
	const u =
		(isRecord(obj.usage) && obj.usage) ||
		(isRecord(obj.response) && isRecord(obj.response.usage) && obj.response.usage);
	return u ? normalizeUsage(u) : null;
};

const geminiUsageExtractor: UsageExtractor = (obj) =>
	isRecord(obj.usageMetadata) ? geminiNativeUsage(obj) : null;

/**
 * Drain an SSE response stream: capture the last token usage it reports (via the
 * supplied extractor) and accumulate the raw body so a streamed response can be
 * cached and replayed verbatim.
 */
async function drainSse(
	stream: ReadableStream<Uint8Array>,
	extract: UsageExtractor
): Promise<DrainedSse> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let raw = '';
	let usage: NormalizedUsage | null = null;
	let complete = false;

	const take = (line: string) => {
		const data = line.slice(5).trim(); // strip "data:"
		if (!data || data === '[DONE]') return;
		try {
			const obj = JSON.parse(data) as Record<string, unknown>;
			const norm = extract(obj);
			if (norm) usage = norm;
		} catch {
			// ignore non-JSON keepalive/comment lines
		}
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			raw += chunk;
			buffer += chunk;
			let nl: number;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.startsWith('data:')) take(line);
			}
		}
		if (buffer.startsWith('data:')) take(buffer);
		complete = true;
	} catch {
		// stream aborted; return whatever we saw and mark it incomplete
	} finally {
		reader.releaseLock();
	}
	return { usage, raw, complete };
}

/**
 * Read the caller's machine token. Accepts
 *   `Authorization: Bearer <token>` (OpenAI SDK shape),
 *   `api-key: <token>` (Azure OpenAI SDK shape), or
 *   `x-goog-api-key: <token>` (Google GenAI SDK shape, used by native ingress),
 * so the same uprox instance can sit behind clients of all three ecosystems.
 */
function readApiKey(event: RequestEvent): string | null {
	const header = event.request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	if (match) return match[1].trim();
	const apiKey = event.request.headers.get('api-key')?.trim();
	if (apiKey) return apiKey;
	const goog = event.request.headers.get('x-goog-api-key')?.trim();
	return goog ? goog : null;
}

/**
 * Read the caller's session/correlation id for trace grouping. Lets the several
 * gateway calls of one logical run — e.g. a tool-use loop — collapse into a
 * single timeline in the trace viewer.
 *
 * Resolution order, so grouping needs *no* client changes in the common case:
 *   1. `x-uprox-trace-id` / `x-uprox-session-id` — explicit opt-in / override.
 *   2. W3C `traceparent` — every OpenTelemetry-instrumented client already sends
 *      this; we extract its 32-hex trace-id. This is also the id uprox shares
 *      with the app's own OTLP spans, so the two stitch into one trace.
 * Returns null when none is present (the call is traced, just not grouped).
 */
function readTraceGroup(event: RequestEvent): string | null {
	const explicit =
		event.request.headers.get('x-uprox-trace-id') ??
		event.request.headers.get('x-uprox-session-id');
	const trimmed = explicit?.trim();
	if (trimmed) return trimmed.slice(0, 200);

	return parseTraceparent(event.request.headers.get('traceparent'));
}

/**
 * Read caller-supplied trace metadata — free-form key/values attached to the
 * trace (the OpenInference `metadata` equivalent): a chat id, end-user id,
 * tenant, experiment, tags, anything. Two sources, merged:
 *   - `x-uprox-metadata`: a JSON object header (richest; nested values allowed).
 *   - `x-uprox-meta-<key>: <value>`: one header per key (string values).
 * Returns null when nothing was sent. Deliberately generic — uprox never
 * special-cases particular keys.
 */
function readTraceMetadata(event: RequestEvent): Record<string, unknown> | null {
	return parseTraceMetadata(event.request.headers.get('x-uprox-metadata'), event.request.headers);
}

export interface GatewayAuth {
	token: ResolvedToken;
	ip: string;
}

/**
 * Authenticate a gateway request via its machine token. Returns either the
 * resolved token context or a ready-to-return error Response.
 */
export async function authenticateGateway(
	event: RequestEvent
): Promise<{ ok: true; auth: GatewayAuth } | { ok: false; response: Response }> {
	const raw = readApiKey(event);
	if (!raw) {
		return { ok: false, response: gatewayError(401, 'Missing API key', 'authentication_error') };
	}
	const token = await resolveToken(raw);
	if (!token) {
		return {
			ok: false,
			response: gatewayError(401, 'Invalid or revoked API key', 'authentication_error')
		};
	}
	return { ok: true, auth: { token, ip: event.getClientAddress() } };
}

interface ProviderCreds {
	apiKey: string;
	/** endpoint override (Azure), null when the static baseUrl applies */
	baseUrl: string | null;
}

/**
 * Load the credentials to use for a provider. A provider may hold several
 * secrets (e.g. multiple Azure OpenAI resources); `preferSecretId` is the
 * calling service's pinned secret, honoured when it belongs to this provider,
 * otherwise the provider's highest-priority secret is used. See
 * selectProviderSecret.
 */
async function loadProviderCreds(
	provider: string,
	preferSecretId?: string | null
): Promise<ProviderCreds | null> {
	const rows = await db.select().from(providerSecret).where(eq(providerSecret.provider, provider));
	const picked = selectProviderSecret(rows, provider, preferSecretId);
	if (!picked) return null;
	return { apiKey: decrypt(picked.encryptedSecret), baseUrl: picked.baseUrl };
}

/** Distinct provider ids the instance has at least one secret configured for. */
async function loadConfiguredProviders(): Promise<string[]> {
	const rows = await db.selectDistinct({ provider: providerSecret.provider }).from(providerSecret);
	return rows.map((r) => r.provider);
}

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
	const { auth, scope, model, path, body, stream, preferProvider } = opts;
	const started = Date.now();
	const { token, ip } = auth;

	// Request tracing: policy override wins over the instance default. When on, we
	// pair each audit row with a request trace (the prompt + response payload) for
	// the in-app trace viewer. auditTrace writes both; pass the response payload on
	// the paths that produced one (cache hits and completions), request-only elsewhere.
	const traceOn = token.policy?.tracingEnabled ?? token.defaultTracingEnabled;
	const traceGroupId = readTraceGroup(event);
	const traceMetadata = readTraceMetadata(event);
	const auditTrace = async (
		entry: AuditEntry,
		resp?: { response?: string | null; format?: 'json' | 'sse' }
	) => {
		const auditLogId = await audit(entry);
		if (traceOn && auditLogId) {
			await recordTrace({
				auditLogId,
				serviceId: token.serviceId,
				groupId: traceGroupId,
				metadata: traceMetadata,
				request: body,
				response: resp?.response ?? null,
				format: resp?.format ?? null
			});
		}
	};

	// Route by model, choosing among the providers this instance has configured.
	// OpenAI and Azure share the model namespace; an explicit `preferProvider`
	// (set by Azure-style URL routes to signal URL-level intent) wins, otherwise
	// the policy's preferredProvider breaks the tie. See resolveProvider.
	const configuredProviders = await loadConfiguredProviders();
	const provider: ProviderDef | null = resolveProvider(
		model,
		configuredProviders,
		preferProvider ?? token.policy?.preferredProvider
	);
	// The model/deployment name to send upstream and price by — passed through
	// unchanged (no provider alias to strip).
	const sendModel = model;
	if (!provider) {
		// Distinguish "we don't recognize this model" from "we recognize it but
		// the instance hasn't configured the provider that would serve it".
		const known = providerForModel(model);
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: known?.id,
			model,
			statusCode: known ? 502 : 400,
			ip,
			detail: known ? `no ${known.id} secret configured` : `unknown model "${model}"`
		});
		return known
			? gatewayError(
					502,
					`No ${PROVIDERS[known.id].label} credentials configured for this instance`,
					'api_error'
				)
			: gatewayError(400, `Unknown or unsupported model: ${model}`, 'model_not_found');
	}

	// capability check: not every provider implements every endpoint
	// (e.g. the Responses API and embeddings are OpenAI-only).
	if (!providerSupports(provider, scope)) {
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 400,
			ip,
			detail: `${provider.id} does not support ${scope}`
		});
		return gatewayError(
			400,
			`${PROVIDERS[provider.id].label} does not support ${scope} requests (model "${model}")`,
			'model_not_found'
		);
	}

	// policy enforcement
	const decision = evaluatePolicy(token, { provider: provider.id, model, scope });
	if (!decision.allow) {
		await auditTrace({
			action: 'policy.deny',
			status: 'deny',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 403,
			ip,
			detail: decision.reason
		});
		return gatewayError(403, `Request denied by policy: ${decision.reason}`, 'permission_error');
	}

	// rate limiting (in-memory, per token) — protects the gateway and upstream
	// from runaway callers before we do any I/O.
	const rl = checkRateLimit(token.tokenId, token.policy?.rateLimitPerMinute ?? 0);
	if (!rl.ok) {
		await auditTrace({
			action: 'policy.deny',
			status: 'deny',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 429,
			ip,
			detail: `rate limit exceeded (${rl.limit}/min)`
		});
		return new Response(
			JSON.stringify({
				error: {
					message: `Rate limit exceeded: ${rl.limit} requests/min`,
					type: 'rate_limit_error',
					code: null,
					param: null
				}
			}),
			{
				status: 429,
				headers: {
					'content-type': 'application/json',
					'retry-after': String(rl.retryAfter ?? 1)
				}
			}
		);
	}

	// exact-match cache: applies to chat, embeddings, and the Responses API.
	// A hit replays the stored upstream response for free — no key, no upstream
	// call, no spend — so we check it before the budget gate.
	// Streaming responses are cacheable too: we buffer the SSE body below and
	// replay it verbatim on a hit. The cache key includes the request's `stream`
	// flag, so a streamed request only ever matches a stored SSE body and a
	// buffered request only matches stored JSON — formats never cross.
	// caching is an instance-wide optimization, not access control: it applies even
	// to services with no policy. A policy's cacheTtlSeconds, when set (non-null),
	// overrides the instance default — including 0 to explicitly opt a policy out.
	// Note on the Responses API: a multi-turn call carries `previous_response_id`,
	// which differs every turn, so its body never collides with another turn —
	// only a byte-identical request is ever served from cache.
	const cacheTtl = token.policy?.cacheTtlSeconds ?? token.defaultCacheTtlSeconds;
	// A Responses API call with store:false isn't persisted by OpenAI, so its
	// returned `id` can't be referenced later — don't cache/replay one.
	const responsesStoreOff = scope === 'responses' && isRecord(body) && body.store === false;
	const cacheable =
		(scope === 'chat' || scope === 'embeddings' || scope === 'responses') &&
		cacheTtl > 0 &&
		!responsesStoreOff &&
		// only cache reproducible requests: embeddings always, chat/responses
		// only when sampling is pinned (temperature 0 or an explicit seed), so
		// two identical-but-varied prompts each reach the model.
		isDeterministicRequest(scope, body);
	const cacheKey = cacheable ? cacheKeyFor(provider.id, path, body) : null;
	if (cacheKey) {
		const hit = await getCached(cacheKey);
		if (hit) {
			await auditTrace(
				{
					action: `gateway.${scope}`,
					status: 'ok',
					serviceId: token.serviceId,
					tokenId: token.tokenId,
					provider: provider.id,
					model,
					statusCode: hit.statusCode,
					costUsd: 0,
					// exact savings: what this request would have cost upstream
					savedUsd: hit.costUsd,
					// tokens the miss consumed — replayed here as "saved" so analytics
					// can show cache impact without double-counting consumption.
					savedInputTokens: hit.inputTokens,
					savedOutputTokens: hit.outputTokens,
					latencyMs: Date.now() - started,
					ip,
					detail: stream ? 'cache hit (stream)' : 'cache hit'
				},
				{ response: hit.response, format: stream ? 'sse' : 'json' }
			);
			return new Response(hit.response, {
				status: hit.statusCode,
				headers: stream
					? {
							'content-type': 'text/event-stream',
							'cache-control': 'no-cache',
							'x-uprox-cache': 'HIT'
						}
					: { 'content-type': 'application/json', 'x-uprox-cache': 'HIT' }
			});
		}
	}

	// budget enforcement: per-service daily/monthly spend ceilings from the policy.
	// When a budget is set, reserve a coarse in-flight estimate the moment we
	// admit the request, so concurrent/streamed requests (whose cost lands in the
	// audit log only after they complete) count toward the ceiling. The exact
	// cost is recorded via the audit log on completion, at which point we release
	// the reservation. `releaseReservation` is a no-op until/unless we reserve, so
	// the completion/error paths below can call it unconditionally.
	let releaseReservation: () => void = () => {};
	if (token.policy) {
		const hasBudget =
			Number(token.policy.dailyBudgetUsd ?? 0) > 0 ||
			Number(token.policy.monthlyBudgetUsd ?? 0) > 0;
		const budget = await checkBudget(token.serviceId, token.policy);
		// Fire-and-forget soft-alert evaluation (instance-wide threshold; emails admins
		// once per window/level). Runs on allow and deny alike so an over-budget
		// request still triggers the "over" alert. Never blocks the request.
		if (hasBudget) {
			void maybeSendBudgetAlert(token.serviceId, token.serviceName, token.policy);
		}
		if (!budget.ok) {
			await auditTrace({
				action: 'policy.deny',
				status: 'deny',
				serviceId: token.serviceId,
				tokenId: token.tokenId,
				provider: provider.id,
				model,
				statusCode: 402,
				ip,
				detail: budget.reason
			});
			return gatewayError(402, `Request denied: ${budget.reason}`, 'insufficient_quota');
		}
		if (hasBudget) releaseReservation = reserve(token.serviceId);
	}

	// upstream credentials — honour the service's pinned secret (e.g. a specific
	// Azure resource) when it belongs to the resolved provider.
	const creds = await loadProviderCreds(provider.id, token.providerSecretId);
	if (!creds) {
		releaseReservation();
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 502,
			ip,
			detail: `no ${provider.id} secret configured`
		});
		return gatewayError(
			502,
			`No ${PROVIDERS[provider.id].label} credentials configured for this instance`,
			'api_error'
		);
	}

	// resolve the upstream base URL — for Azure this is the instance's configured
	// resource endpoint; a misconfigured endpoint-based provider can't be reached.
	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		releaseReservation();
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 502,
			ip,
			detail: `no ${provider.id} endpoint configured`
		});
		return gatewayError(
			502,
			`No ${PROVIDERS[provider.id].label} endpoint configured for this instance`,
			'api_error'
		);
	}

	// A provider with an adapter speaks a non-OpenAI native API; it builds its own
	// URL and translates the request/response bodies. Pass-through providers send
	// the OpenAI request verbatim to `${baseUrl}${path}`.
	const adapter = getAdapter(provider.id);

	let outboundBody = body;
	// For streamed chat completions, ask the upstream to emit a final usage
	// chunk; otherwise streaming responses carry no token counts and we can't
	// compute cost. Don't clobber a caller-supplied stream_options. Adapters emit
	// their own usage chunk, so this OpenAI-only knob is skipped for them.
	if (!adapter && stream && path.endsWith('/chat/completions') && isRecord(outboundBody)) {
		const existing = isRecord(outboundBody.stream_options) ? outboundBody.stream_options : {};
		outboundBody = { ...outboundBody, stream_options: { ...existing, include_usage: true } };
	}

	const upstreamUrl = adapter
		? adapter.buildUrl({ baseUrl, scope, model: sendModel, stream })
		: `${baseUrl}${path}`;
	const upstreamBody = adapter ? adapter.translateRequest(scope, outboundBody) : outboundBody;

	// proxy upstream
	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...authHeaders(provider, creds.apiKey)
			},
			body: JSON.stringify(upstreamBody)
		});
	} catch (err) {
		releaseReservation();
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 502,
			latencyMs: Date.now() - started,
			ip,
			detail: err instanceof Error ? err.message : 'upstream fetch failed'
		});
		return gatewayError(502, 'Upstream provider request failed', 'api_error');
	}

	// streaming: tee the body — one branch goes to the client untouched, the
	// other is drained in the background to extract the final usage chunk so we
	// can still record cost. The audit fires once the stream finishes. For an
	// adapter provider we first translate the native event stream into OpenAI SSE,
	// so both the client branch and the usage drain see the familiar shape.
	if (stream && upstream.ok && upstream.body) {
		const sourceStream = adapter
			? adapter.translateStream({ model: sendModel }, upstream.body)
			: upstream.body;
		const [clientBranch, costBranch] = sourceStream.tee();
		void (async () => {
			try {
				const { usage, raw, complete } = await drainSse(costBranch, openAiUsageExtractor);
				const { estimateCostUsd } = await import('$lib/server/providers');
				const cost = usage
					? await estimateCostUsd(
							sendModel,
							usage.input ?? undefined,
							usage.output ?? undefined,
							usage.cacheRead ?? 0,
							usage.cacheWrite ?? 0
						)
					: null;
				await auditTrace(
					{
						action: `gateway.${scope}`,
						status: 'ok',
						serviceId: token.serviceId,
						tokenId: token.tokenId,
						provider: provider.id,
						model,
						statusCode: upstream.status,
						costUsd: cost,
						inputTokens: usage?.input ?? null,
						outputTokens: usage?.output ?? null,
						providerCachedTokens: usage?.cacheRead ?? null,
						cacheWriteTokens: usage?.cacheWrite ?? null,
						latencyMs: Date.now() - started,
						ip,
						detail: 'stream'
					},
					{ response: raw, format: 'sse' }
				);
				// only cache a stream that finished cleanly — never a truncated one
				if (cacheKey && complete && raw) {
					await putCached({
						cacheKey,
						provider: provider.id,
						model,
						statusCode: upstream.status,
						response: raw,
						costUsd: cost,
						inputTokens: usage?.input ?? null,
						outputTokens: usage?.output ?? null,
						ttlSeconds: cacheTtl
					});
				}
			} finally {
				// real cost is now in the audit log — drop the in-flight reservation
				releaseReservation();
			}
		})();
		return new Response(clientBranch, {
			status: upstream.status,
			headers: {
				'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
				'cache-control': 'no-cache',
				...(cacheKey ? { 'x-uprox-cache': 'MISS' } : {})
			}
		});
	}

	// buffered response: translate (for adapter providers) then parse usage for
	// cost tracking. After translation the body is OpenAI-shaped, so usage parsing,
	// caching and the returned payload all use the same code path as pass-through.
	const rawText = await upstream.text();
	const text = adapter
		? adapter.translateResponse({ scope, model: sendModel, text: rawText, ok: upstream.ok })
		: rawText;
	let cost: number | null = null;
	let cachedTokens: number | null = null;
	let cacheWriteTokens: number | null = null;
	let inputTokens: number | null = null;
	let outputTokens: number | null = null;
	try {
		const parsed = JSON.parse(text) as { usage?: unknown };
		const usage = normalizeUsage(parsed.usage);
		const { estimateCostUsd } = await import('$lib/server/providers');
		inputTokens = usage?.input ?? null;
		outputTokens = usage?.output ?? null;
		cachedTokens = usage?.cacheRead ?? null;
		cacheWriteTokens = usage?.cacheWrite ?? null;
		cost = await estimateCostUsd(
			sendModel,
			inputTokens ?? undefined,
			outputTokens ?? undefined,
			cachedTokens ?? 0,
			cacheWriteTokens ?? 0
		);
	} catch {
		// non-JSON or no usage; leave cost null
	}

	await auditTrace(
		{
			action: `gateway.${scope}`,
			status: upstream.ok ? 'ok' : 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: upstream.status,
			costUsd: cost,
			inputTokens,
			outputTokens,
			providerCachedTokens: cachedTokens,
			cacheWriteTokens,
			latencyMs: Date.now() - started,
			ip
		},
		{ response: text, format: 'json' }
	);
	// real cost is now in the audit log — drop the in-flight reservation
	releaseReservation();

	// populate the cache on a successful, cacheable response
	if (cacheKey && upstream.ok) {
		await putCached({
			cacheKey,
			provider: provider.id,
			model,
			statusCode: upstream.status,
			response: text,
			costUsd: cost,
			inputTokens,
			outputTokens,
			ttlSeconds: cacheTtl
		});
	}

	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': 'application/json',
			...(cacheKey ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}

export { loadProviderCreds };

/**
 * Native-Gemini error envelope (`{ error: { code, message, status } }`), so the
 * Google GenAI SDK — which expects native errors, not OpenAI ones — parses a
 * gateway rejection correctly.
 */
function geminiNativeError(status: number, message: string, googleStatus: string): Response {
	return json({ error: { code: status, message, status: googleStatus } }, { status });
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
	const started = Date.now();
	const { token, ip } = auth;
	const provider = PROVIDERS.gemini;

	// Request tracing (see proxyToProvider): pair each audit row with the captured
	// native request/response payload for the trace viewer when tracing is enabled.
	const traceOn = token.policy?.tracingEnabled ?? token.defaultTracingEnabled;
	const traceGroupId = readTraceGroup(event);
	const traceMetadata = readTraceMetadata(event);
	const auditTrace = async (
		entry: AuditEntry,
		resp?: { response?: string | null; format?: 'json' | 'sse' }
	) => {
		const auditLogId = await audit(entry);
		if (traceOn && auditLogId) {
			await recordTrace({
				auditLogId,
				serviceId: token.serviceId,
				groupId: traceGroupId,
				metadata: traceMetadata,
				request: body,
				response: resp?.response ?? null,
				format: resp?.format ?? null
			});
		}
	};

	// capability check (chat + embeddings only)
	if (!providerSupports(provider, scope)) {
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 400,
			ip,
			detail: `gemini does not support ${scope}`
		});
		return geminiNativeError(400, `Gemini does not support ${scope} requests`, 'INVALID_ARGUMENT');
	}

	// policy enforcement
	const decision = evaluatePolicy(token, { provider: provider.id, model, scope });
	if (!decision.allow) {
		await auditTrace({
			action: 'policy.deny',
			status: 'deny',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 403,
			ip,
			detail: decision.reason
		});
		return geminiNativeError(
			403,
			`Request denied by policy: ${decision.reason}`,
			'PERMISSION_DENIED'
		);
	}

	// rate limiting (in-memory, per token)
	const rl = checkRateLimit(token.tokenId, token.policy?.rateLimitPerMinute ?? 0);
	if (!rl.ok) {
		await auditTrace({
			action: 'policy.deny',
			status: 'deny',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 429,
			ip,
			detail: `rate limit exceeded (${rl.limit}/min)`
		});
		return geminiNativeError(
			429,
			`Rate limit exceeded: ${rl.limit} requests/min`,
			'RESOURCE_EXHAUSTED'
		);
	}

	// exact-match cache. Determinism for native bodies: embeddings always;
	// generateContent only when sampling is pinned (generationConfig.temperature 0).
	const cacheTtl = token.policy?.cacheTtlSeconds ?? token.defaultCacheTtlSeconds;
	const genCfg = isRecord(body) && isRecord(body.generationConfig) ? body.generationConfig : null;
	const deterministic = scope === 'embeddings' || (genCfg != null && genCfg.temperature === 0);
	const cacheable = (scope === 'chat' || scope === 'embeddings') && cacheTtl > 0 && deterministic;
	// Key on the native path + body; distinct from the OpenAI-ingress cache (which
	// keys on `/chat/completions` + an OpenAI body), so formats never cross.
	const cachePath = `/models/${model}:${method}`;
	const cacheKey = cacheable ? cacheKeyFor(provider.id, cachePath, body) : null;
	if (cacheKey) {
		const hit = await getCached(cacheKey);
		if (hit) {
			await auditTrace(
				{
					action: `gateway.${scope}`,
					status: 'ok',
					serviceId: token.serviceId,
					tokenId: token.tokenId,
					provider: provider.id,
					model,
					statusCode: hit.statusCode,
					costUsd: 0,
					savedUsd: hit.costUsd,
					savedInputTokens: hit.inputTokens,
					savedOutputTokens: hit.outputTokens,
					latencyMs: Date.now() - started,
					ip,
					detail: stream ? 'native cache hit (stream)' : 'native cache hit'
				},
				{ response: hit.response, format: stream ? 'sse' : 'json' }
			);
			return new Response(hit.response, {
				status: hit.statusCode,
				headers: stream
					? {
							'content-type': 'text/event-stream',
							'cache-control': 'no-cache',
							'x-uprox-cache': 'HIT'
						}
					: { 'content-type': 'application/json', 'x-uprox-cache': 'HIT' }
			});
		}
	}

	// budget enforcement (per-service daily/monthly ceilings), mirroring proxyToProvider.
	let releaseReservation: () => void = () => {};
	if (token.policy) {
		const hasBudget =
			Number(token.policy.dailyBudgetUsd ?? 0) > 0 ||
			Number(token.policy.monthlyBudgetUsd ?? 0) > 0;
		const budget = await checkBudget(token.serviceId, token.policy);
		if (hasBudget) {
			void maybeSendBudgetAlert(token.serviceId, token.serviceName, token.policy);
		}
		if (!budget.ok) {
			await auditTrace({
				action: 'policy.deny',
				status: 'deny',
				serviceId: token.serviceId,
				tokenId: token.tokenId,
				provider: provider.id,
				model,
				statusCode: 402,
				ip,
				detail: budget.reason
			});
			return geminiNativeError(402, `Request denied: ${budget.reason}`, 'RESOURCE_EXHAUSTED');
		}
		if (hasBudget) releaseReservation = reserve(token.serviceId);
	}

	// upstream credentials and (static) base URL
	const creds = await loadProviderCreds(provider.id, token.providerSecretId);
	if (!creds) {
		releaseReservation();
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 502,
			ip,
			detail: 'no gemini secret configured'
		});
		return geminiNativeError(
			502,
			'No Google Gemini credentials configured for this instance',
			'FAILED_PRECONDITION'
		);
	}
	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		releaseReservation();
		return geminiNativeError(502, 'No Google Gemini endpoint configured', 'FAILED_PRECONDITION');
	}

	// Forward the query string verbatim except `key` — the Google SDK may put the
	// API key there, and that's the uprox token, which must never reach Google.
	const search = new URLSearchParams(event.url.search);
	search.delete('key');
	const qs = search.toString();
	const upstreamUrl = `${baseUrl}/models/${model}:${method}${qs ? `?${qs}` : ''}`;

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...authHeaders(provider, creds.apiKey)
			},
			body: JSON.stringify(body)
		});
	} catch (err) {
		releaseReservation();
		await auditTrace({
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 502,
			latencyMs: Date.now() - started,
			ip,
			detail: err instanceof Error ? err.message : 'upstream fetch failed'
		});
		return geminiNativeError(502, 'Upstream provider request failed', 'UNAVAILABLE');
	}

	// streaming passthrough: tee — client gets the native SSE untouched; the cost
	// branch is drained for the native usageMetadata so we can still bill it.
	if (stream && upstream.ok && upstream.body) {
		const [clientBranch, costBranch] = upstream.body.tee();
		void (async () => {
			try {
				const { usage, raw, complete } = await drainSse(costBranch, geminiUsageExtractor);
				const { estimateCostUsd } = await import('$lib/server/providers');
				const cost = usage
					? await estimateCostUsd(
							model,
							usage.input ?? undefined,
							usage.output ?? undefined,
							usage.cacheRead ?? 0,
							usage.cacheWrite ?? 0
						)
					: null;
				await auditTrace(
					{
						action: `gateway.${scope}`,
						status: 'ok',
						serviceId: token.serviceId,
						tokenId: token.tokenId,
						provider: provider.id,
						model,
						statusCode: upstream.status,
						costUsd: cost,
						inputTokens: usage?.input ?? null,
						outputTokens: usage?.output ?? null,
						providerCachedTokens: usage?.cacheRead ?? null,
						cacheWriteTokens: usage?.cacheWrite ?? null,
						latencyMs: Date.now() - started,
						ip,
						detail: 'native stream'
					},
					{ response: raw, format: 'sse' }
				);
				if (cacheKey && complete && raw) {
					await putCached({
						cacheKey,
						provider: provider.id,
						model,
						statusCode: upstream.status,
						response: raw,
						costUsd: cost,
						inputTokens: usage?.input ?? null,
						outputTokens: usage?.output ?? null,
						ttlSeconds: cacheTtl
					});
				}
			} finally {
				releaseReservation();
			}
		})();
		return new Response(clientBranch, {
			status: upstream.status,
			headers: {
				'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
				'cache-control': 'no-cache',
				...(cacheKey ? { 'x-uprox-cache': 'MISS' } : {})
			}
		});
	}

	// buffered passthrough: read native usageMetadata for cost, return body as-is.
	const text = await upstream.text();
	let cost: number | null = null;
	let cachedTokens: number | null = null;
	let cacheWriteTokens: number | null = null;
	let inputTokens: number | null = null;
	let outputTokens: number | null = null;
	try {
		const usage = geminiNativeUsage(JSON.parse(text));
		const { estimateCostUsd } = await import('$lib/server/providers');
		inputTokens = usage?.input ?? null;
		outputTokens = usage?.output ?? null;
		cachedTokens = usage?.cacheRead ?? null;
		cacheWriteTokens = usage?.cacheWrite ?? null;
		cost = await estimateCostUsd(
			model,
			inputTokens ?? undefined,
			outputTokens ?? undefined,
			cachedTokens ?? 0,
			cacheWriteTokens ?? 0
		);
	} catch {
		// non-JSON or no usage; leave cost null
	}

	await auditTrace(
		{
			action: `gateway.${scope}`,
			status: upstream.ok ? 'ok' : 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: upstream.status,
			costUsd: cost,
			inputTokens,
			outputTokens,
			providerCachedTokens: cachedTokens,
			cacheWriteTokens,
			latencyMs: Date.now() - started,
			ip,
			detail: 'native'
		},
		{ response: text, format: 'json' }
	);
	releaseReservation();

	if (cacheKey && upstream.ok) {
		await putCached({
			cacheKey,
			provider: provider.id,
			model,
			statusCode: upstream.status,
			response: text,
			costUsd: cost,
			inputTokens,
			outputTokens,
			ttlSeconds: cacheTtl
		});
	}

	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/json',
			...(cacheKey ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}

/**
 * Native model discovery for the Google GenAI SDK: `GET /v1beta/models` (list,
 * `ai.models.list()`) and `GET /v1beta/models/{model}` (get, `ai.models.get()`).
 * Proxies to Gemini and, for the list, drops models the token's policy forbids —
 * mirroring the OpenAI `/v1/models` catalog. Not billable: no cost, cache, or
 * budget, just auth + policy + passthrough.
 */
export async function proxyGeminiModels(
	event: RequestEvent,
	auth: GatewayAuth,
	model: string | null
): Promise<Response> {
	const { token, ip } = auth;
	const provider = PROVIDERS.gemini;

	// A specific model the policy forbids reads as "not found"; for the list we
	// gate at the provider level and return an empty catalog when gemini is fully
	// disallowed (no upstream call), matching the OpenAI models route.
	if (
		!evaluatePolicy(token, { provider: provider.id, model: model ?? '', scope: 'models' }).allow
	) {
		if (model) return geminiNativeError(404, `Model "${model}" is not available`, 'NOT_FOUND');
		return json({ models: [] });
	}

	const creds = await loadProviderCreds(provider.id, token.providerSecretId);
	if (!creds) {
		return geminiNativeError(
			502,
			'No Google Gemini credentials configured for this instance',
			'FAILED_PRECONDITION'
		);
	}
	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		return geminiNativeError(502, 'No Google Gemini endpoint configured', 'FAILED_PRECONDITION');
	}

	// forward pagination/query verbatim, minus the auth `key` param
	const search = new URLSearchParams(event.url.search);
	search.delete('key');
	const qs = search.toString();
	const url = `${baseUrl}/models${model ? `/${model}` : ''}${qs ? `?${qs}` : ''}`;

	let upstream: Response;
	try {
		upstream = await fetch(url, { headers: authHeaders(provider, creds.apiKey) });
	} catch (err) {
		await audit({
			action: 'gateway.models',
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model: model ?? undefined,
			statusCode: 502,
			ip,
			detail: err instanceof Error ? err.message : 'upstream fetch failed'
		});
		return geminiNativeError(502, 'Upstream provider request failed', 'UNAVAILABLE');
	}

	const text = await upstream.text();
	if (!upstream.ok) {
		await audit({
			action: 'gateway.models',
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model: model ?? undefined,
			statusCode: upstream.status,
			ip,
			detail: model ? `get ${model}` : 'list'
		});
		return new Response(text, {
			status: upstream.status,
			headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }
		});
	}

	// models.get → return the single (already policy-checked) model object as-is
	if (model) {
		await audit({
			action: 'gateway.models',
			status: 'ok',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 200,
			ip,
			detail: `get ${model}`
		});
		return new Response(text, {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	// models.list → filter the native array by the token's per-model policy,
	// preserving the native shape (and nextPageToken for pagination).
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = null;
	}
	const all = isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : [];
	const allowed = all.filter((m) => {
		const name = isRecord(m) && typeof m.name === 'string' ? m.name.replace(/^models\//, '') : '';
		return (
			Boolean(name) &&
			evaluatePolicy(token, { provider: provider.id, model: name, scope: 'models' }).allow
		);
	});
	const out: Record<string, unknown> = { models: allowed };
	if (isRecord(parsed) && typeof parsed.nextPageToken === 'string') {
		out.nextPageToken = parsed.nextPageToken;
	}

	await audit({
		action: 'gateway.models',
		status: 'ok',
		serviceId: token.serviceId,
		tokenId: token.tokenId,
		provider: provider.id,
		statusCode: 200,
		ip,
		detail: `${allowed.length} models`
	});
	return json(out);
}

export interface RawProxyOptions {
	auth: GatewayAuth;
	/** which configured provider to route to (no model-based routing for files) */
	provider: 'openai' | 'azure';
	/** upstream path appended to the provider base url, e.g. "/files" */
	path: string;
}

/**
 * Stream-through proxy for endpoints whose body isn't JSON (Files API uploads
 * are multipart/form-data; downloads are binary). The request body and the
 * upstream response body are forwarded as opaque streams, so payload size and
 * content-type are preserved. Auth, provider selection, and audit are the same
 * as the JSON path, but model routing, policy by-model, caching, budget
 * estimation, and rate limiting are skipped — there's no model to scope by.
 *
 * Query strings (e.g. Azure's `?api-version=…`) are forwarded as-is so the
 * upstream sees the version the client specified.
 */
export async function proxyRawUpstream(
	event: RequestEvent,
	opts: RawProxyOptions
): Promise<Response> {
	const { auth, provider: providerId, path } = opts;
	const started = Date.now();
	const { token, ip } = auth;
	const method = event.request.method;

	const provider = PROVIDERS[providerId];
	if (!provider) return gatewayError(500, 'Unknown provider', 'api_error');

	const creds = await loadProviderCreds(providerId, token.providerSecretId);
	if (!creds) {
		await audit({
			action: `gateway.files`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 502,
			ip,
			detail: `no ${providerId} secret configured`
		});
		return gatewayError(
			502,
			`No ${provider.label} credentials configured for this instance`,
			'api_error'
		);
	}

	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		await audit({
			action: `gateway.files`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 502,
			ip,
			detail: `no ${providerId} endpoint configured`
		});
		return gatewayError(
			502,
			`No ${provider.label} endpoint configured for this instance`,
			'api_error'
		);
	}

	// Forward the original query string (api-version etc.) verbatim.
	const upstreamUrl = `${baseUrl}${path}${event.url.search}`;

	// Build upstream headers: keep the client's content-type so multipart
	// boundaries survive, drop hop-by-hop and host headers, override auth.
	const fwdHeaders: Record<string, string> = {};
	const ct = event.request.headers.get('content-type');
	if (ct) fwdHeaders['content-type'] = ct;
	const accept = event.request.headers.get('accept');
	if (accept) fwdHeaders['accept'] = accept;
	Object.assign(fwdHeaders, authHeaders(provider, creds.apiKey));

	const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method,
			headers: fwdHeaders,
			body: hasBody ? event.request.body : undefined,
			// Required by undici when streaming a request body.
			...(hasBody ? { duplex: 'half' } : {})
		} as RequestInit & { duplex?: 'half' });
	} catch (err) {
		await audit({
			action: `gateway.files`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 502,
			latencyMs: Date.now() - started,
			ip,
			detail: err instanceof Error ? err.message : 'upstream fetch failed'
		});
		return gatewayError(502, 'Upstream provider request failed', 'api_error');
	}

	await audit({
		action: `gateway.files`,
		status: upstream.ok ? 'ok' : 'error',
		serviceId: token.serviceId,
		tokenId: token.tokenId,
		provider: providerId,
		statusCode: upstream.status,
		latencyMs: Date.now() - started,
		ip,
		detail: `${method} ${path}`
	});

	// Stream the upstream response straight back, preserving content-type.
	const outHeaders = new Headers();
	const outCt = upstream.headers.get('content-type');
	if (outCt) outHeaders.set('content-type', outCt);
	const outCl = upstream.headers.get('content-length');
	if (outCl) outHeaders.set('content-length', outCl);
	return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}
