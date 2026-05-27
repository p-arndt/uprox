import { json, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
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
	PROVIDERS,
	type Capability,
	type ProviderDef
} from '$lib/server/providers';
import { audit } from '$lib/server/audit';
import { checkRateLimit } from '$lib/server/ratelimit';
import { checkBudget } from '$lib/server/budget';
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

/** Pull the bearer token out of the Authorization header. */
function bearer(event: RequestEvent): string | null {
	const header = event.request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match ? match[1].trim() : null;
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
	const raw = bearer(event);
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
	/** per-org endpoint override (Azure), null when the static baseUrl applies */
	baseUrl: string | null;
}

async function loadProviderCreds(orgId: string, provider: string): Promise<ProviderCreds | null> {
	const [row] = await db
		.select()
		.from(providerSecret)
		.where(and(eq(providerSecret.organizationId, orgId), eq(providerSecret.provider, provider)))
		.limit(1);
	if (!row) return null;
	return { apiKey: decrypt(row.encryptedSecret), baseUrl: row.baseUrl };
}

/** Provider ids the organization has credentials configured for. */
async function loadConfiguredProviders(orgId: string): Promise<string[]> {
	const rows = await db
		.select({ provider: providerSecret.provider })
		.from(providerSecret)
		.where(eq(providerSecret.organizationId, orgId));
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
}

/**
 * The core request flow: route by model → enforce policy → load the upstream
 * key → proxy to the provider → audit. Returns a Response either way.
 */
export async function proxyToProvider(event: RequestEvent, opts: ProxyOptions): Promise<Response> {
	const { auth, scope, model, path, body, stream } = opts;
	const started = Date.now();
	const { token, ip } = auth;

	// Route by model, choosing among the providers this org has configured.
	// OpenAI and Azure share the model namespace; the policy's preferredProvider
	// breaks the tie when both are configured (see resolveProvider).
	const configuredProviders = await loadConfiguredProviders(token.organizationId);
	const provider: ProviderDef | null = resolveProvider(
		model,
		configuredProviders,
		token.policy?.preferredProvider
	);
	// The model/deployment name to send upstream and price by — passed through
	// unchanged (no provider alias to strip).
	const sendModel = model;
	if (!provider) {
		// Distinguish "we don't recognize this model" from "we recognize it but
		// the org hasn't configured the provider that would serve it".
		const known = providerForModel(model);
		await audit({
			organizationId: token.organizationId,
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
					`No ${PROVIDERS[known.id].label} credentials configured for this organization`,
					'api_error'
				)
			: gatewayError(400, `Unknown or unsupported model: ${model}`, 'model_not_found');
	}

	// capability check: not every provider implements every endpoint
	// (e.g. the Responses API and embeddings are OpenAI-only).
	if (!providerSupports(provider, scope)) {
		await audit({
			organizationId: token.organizationId,
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
			organizationId: token.organizationId,
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
			organizationId: token.organizationId,
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
	// caching is an org-wide optimization, not access control: it applies even
	// to services with no policy. A policy's cacheTtlSeconds, when set (non-null),
	// overrides the org default — including 0 to explicitly opt a policy out.
	// Note on the Responses API: a multi-turn call carries `previous_response_id`,
	// which differs every turn, so its body never collides with another turn —
	// only a byte-identical request is ever served from cache.
	const cacheTtl = token.policy?.cacheTtlSeconds ?? token.orgCacheTtlSeconds;
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
		const hit = await getCached(token.organizationId, cacheKey);
		if (hit) {
			await audit({
				organizationId: token.organizationId,
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
	if (token.policy) {
		const budget = await checkBudget(token.serviceId, token.policy);
		if (!budget.ok) {
			await audit({
				organizationId: token.organizationId,
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
	}

	// upstream credentials
	const creds = await loadProviderCreds(token.organizationId, provider.id);
	if (!creds) {
		await audit({
			organizationId: token.organizationId,
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
			`No ${PROVIDERS[provider.id].label} credentials configured for this organization`,
			'api_error'
		);
	}

	// resolve the upstream base URL — for Azure this is the org's configured
	// resource endpoint; a misconfigured endpoint-based provider can't be reached.
	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		await audit({
			organizationId: token.organizationId,
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
			`No ${PROVIDERS[provider.id].label} endpoint configured for this organization`,
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
		await audit({
			organizationId: token.organizationId,
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
			const { usage, raw, complete } = await readSseUsage(costBranch);
			const { estimateCostUsd } = await import('$lib/server/providers');
			const cost = usage
				? await estimateCostUsd(token.organizationId, sendModel, usage.input, usage.output)
				: null;
			await audit({
				organizationId: token.organizationId,
				action: `gateway.${scope}`,
				status: 'ok',
				serviceId: token.serviceId,
				tokenId: token.tokenId,
				provider: provider.id,
				model,
				statusCode: upstream.status,
				costUsd: cost,
				providerCachedTokens: usage?.cachedInput ?? null,
				latencyMs: Date.now() - started,
				ip,
				detail: 'stream'
			});
			// only cache a stream that finished cleanly — never a truncated one
			if (cacheKey && complete && raw) {
				await putCached({
					organizationId: token.organizationId,
					cacheKey,
					provider: provider.id,
					model,
					statusCode: upstream.status,
					response: raw,
					costUsd: cost,
					ttlSeconds: cacheTtl
				});
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
		const inputTokens = parsed.usage?.prompt_tokens ?? parsed.usage?.input_tokens;
		const outputTokens = parsed.usage?.completion_tokens ?? parsed.usage?.output_tokens;
		cost = await estimateCostUsd(token.organizationId, sendModel, inputTokens, outputTokens);
		cachedTokens = providerCachedTokens(parsed.usage);
	} catch {
		// non-JSON or no usage; leave cost null
	}

	await audit({
		organizationId: token.organizationId,
		action: `gateway.${scope}`,
		status: upstream.ok ? 'ok' : 'error',
		serviceId: token.serviceId,
		tokenId: token.tokenId,
		provider: provider.id,
		model,
		statusCode: upstream.status,
		costUsd: cost,
		providerCachedTokens: cachedTokens,
		latencyMs: Date.now() - started,
		ip
	});

	// populate the cache on a successful, cacheable response
	if (cacheKey && upstream.ok) {
		await putCached({
			organizationId: token.organizationId,
			cacheKey,
			provider: provider.id,
			model,
			statusCode: upstream.status,
			response: text,
			costUsd: cost,
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
