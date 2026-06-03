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
import { audit } from '$lib/server/audit';
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

/**
 * Input tokens the upstream provider served from its *own* prompt cache, read
 * from a usage object. Spans the chat shape
 * (`prompt_tokens_details.cached_tokens`), the Responses shape
 * (`input_tokens_details.cached_tokens`), and Anthropic's
 * (`cache_read_input_tokens`). Returns null when no cache usage is reported.
 * This is the provider's discount on repeated input — unrelated to uprox's own
 * exact-match response cache.
 */
function providerCachedTokens(usage: unknown): number | null {
	if (!isRecord(usage)) return null;
	const fromDetails = (d: unknown) =>
		isRecord(d) && typeof d.cached_tokens === 'number' ? d.cached_tokens : null;
	return (
		fromDetails(usage.prompt_tokens_details) ??
		fromDetails(usage.input_tokens_details) ??
		(typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : null)
	);
}

interface DrainedSse {
	usage: { input?: number; output?: number; cachedInput?: number | null } | null;
	/** the verbatim SSE body, reassembled — used to cache a streamed response */
	raw: string;
	/** false if the stream errored/aborted before completing (don't cache) */
	complete: boolean;
}

/**
 * Drain an SSE response stream: capture the last token usage it reports and
 * accumulate the raw body so a streamed response can be cached and replayed.
 * Handles both the chat/completions shape (`{ usage: {...} }` on a trailing
 * chunk) and the Responses API shape (`{ response: { usage: {...} } }`).
 */
async function readSseUsage(stream: ReadableStream<Uint8Array>): Promise<DrainedSse> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let raw = '';
	let usage: { input?: number; output?: number; cachedInput?: number | null } | null = null;
	let complete = false;

	const take = (line: string) => {
		const data = line.slice(5).trim(); // strip "data:"
		if (!data || data === '[DONE]') return;
		try {
			const obj = JSON.parse(data) as Record<string, unknown>;
			const u =
				(isRecord(obj.usage) && obj.usage) ||
				(isRecord(obj.response) && isRecord(obj.response.usage) && obj.response.usage);
			if (u) {
				const rec = u as Record<string, unknown>;
				const input = (rec.prompt_tokens ?? rec.input_tokens) as number | undefined;
				const output = (rec.completion_tokens ?? rec.output_tokens) as number | undefined;
				const cachedInput = providerCachedTokens(rec);
				if (input != null || output != null || cachedInput != null)
					usage = { input, output, cachedInput };
			}
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
 * Read the caller's machine token. Accepts either
 *   `Authorization: Bearer <token>` (OpenAI SDK shape) or
 *   `api-key: <token>` (Azure OpenAI SDK shape),
 * so the same uprox endpoint can sit behind clients of both ecosystems.
 */
function readApiKey(event: RequestEvent): string | null {
	const header = event.request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	if (match) return match[1].trim();
	const apiKey = event.request.headers.get('api-key')?.trim();
	return apiKey ? apiKey : null;
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
		await audit({
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
		await audit({
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
		await audit({
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
		await audit({
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
			await audit({
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
			});
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
			await audit({
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
		await audit({
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
		await audit({
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

	let outboundBody = body;
	// For streamed chat completions, ask the upstream to emit a final usage
	// chunk; otherwise streaming responses carry no token counts and we can't
	// compute cost. Don't clobber a caller-supplied stream_options.
	if (stream && path.endsWith('/chat/completions') && isRecord(outboundBody)) {
		const existing = isRecord(outboundBody.stream_options) ? outboundBody.stream_options : {};
		outboundBody = { ...outboundBody, stream_options: { ...existing, include_usage: true } };
	}

	// proxy upstream
	let upstream: Response;
	try {
		upstream = await fetch(`${baseUrl}${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...authHeaders(provider, creds.apiKey)
			},
			body: JSON.stringify(outboundBody)
		});
	} catch (err) {
		releaseReservation();
		await audit({
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
	// can still record cost. The audit fires once the stream finishes.
	if (stream && upstream.ok && upstream.body) {
		const [clientBranch, costBranch] = upstream.body.tee();
		void (async () => {
			try {
				const { usage, raw, complete } = await readSseUsage(costBranch);
				const { estimateCostUsd } = await import('$lib/server/providers');
				const cost = usage ? await estimateCostUsd(sendModel, usage.input, usage.output) : null;
				await audit({
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
					providerCachedTokens: usage?.cachedInput ?? null,
					latencyMs: Date.now() - started,
					ip,
					detail: 'stream'
				});
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

	// buffered response: parse usage for cost tracking
	const text = await upstream.text();
	let cost: number | null = null;
	let cachedTokens: number | null = null;
	let inputTokens: number | null = null;
	let outputTokens: number | null = null;
	try {
		const parsed = JSON.parse(text) as {
			usage?: {
				// chat/completions & embeddings
				prompt_tokens?: number;
				completion_tokens?: number;
				// responses api
				input_tokens?: number;
				output_tokens?: number;
			};
		};
		const { estimateCostUsd } = await import('$lib/server/providers');
		inputTokens = parsed.usage?.prompt_tokens ?? parsed.usage?.input_tokens ?? null;
		outputTokens = parsed.usage?.completion_tokens ?? parsed.usage?.output_tokens ?? null;
		cost = await estimateCostUsd(sendModel, inputTokens ?? undefined, outputTokens ?? undefined);
		cachedTokens = providerCachedTokens(parsed.usage);
	} catch {
		// non-JSON or no usage; leave cost null
	}

	await audit({
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
		latencyMs: Date.now() - started,
		ip
	});
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
