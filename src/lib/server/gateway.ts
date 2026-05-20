import { json, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { providerSecret } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { resolveToken, type ResolvedToken } from '$lib/server/tokens';
import { evaluatePolicy } from '$lib/server/policy';
import {
	providerForModel,
	providerSupports,
	PROVIDERS,
	type Capability,
	type ProviderDef
} from '$lib/server/providers';
import { audit } from '$lib/server/audit';

/** OpenAI-style error envelope, so OpenAI SDK clients parse it correctly. */
export function gatewayError(status: number, message: string, type = 'invalid_request_error') {
	return json({ error: { message, type, code: null, param: null } }, { status });
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Drain an SSE response stream and return the last token usage it reports.
 * Handles both the chat/completions shape (`{ usage: {...} }` on a trailing
 * chunk) and the Responses API shape (`{ response: { usage: {...} } }`).
 */
async function readSseUsage(
	stream: ReadableStream<Uint8Array>
): Promise<{ input?: number; output?: number } | null> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let usage: { input?: number; output?: number } | null = null;

	const take = (line: string) => {
		const data = line.slice(5).trim(); // strip "data:"
		if (!data || data === '[DONE]') return;
		try {
			const obj = JSON.parse(data) as Record<string, unknown>;
			const u = (isRecord(obj.usage) && obj.usage) ||
				(isRecord(obj.response) && isRecord(obj.response.usage) && obj.response.usage);
			if (u) {
				const rec = u as Record<string, unknown>;
				const input = (rec.prompt_tokens ?? rec.input_tokens) as number | undefined;
				const output = (rec.completion_tokens ?? rec.output_tokens) as number | undefined;
				if (input != null || output != null) usage = { input, output };
			}
		} catch {
			// ignore non-JSON keepalive/comment lines
		}
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let nl: number;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.startsWith('data:')) take(line);
			}
		}
		if (buffer.startsWith('data:')) take(buffer);
	} catch {
		// stream aborted; return whatever usage we saw (likely null)
	} finally {
		reader.releaseLock();
	}
	return usage;
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

async function loadProviderKey(orgId: string, provider: string): Promise<string | null> {
	const [row] = await db
		.select()
		.from(providerSecret)
		.where(and(eq(providerSecret.organizationId, orgId), eq(providerSecret.provider, provider)))
		.limit(1);
	if (!row) return null;
	return decrypt(row.encryptedSecret);
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

	const provider: ProviderDef | null = providerForModel(model);
	if (!provider) {
		await audit({
			organizationId: token.organizationId,
			action: `gateway.${scope}`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			model,
			statusCode: 400,
			ip,
			detail: `unknown model "${model}"`
		});
		return gatewayError(400, `Unknown or unsupported model: ${model}`, 'model_not_found');
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

	// upstream credentials
	const apiKey = await loadProviderKey(token.organizationId, provider.id);
	if (!apiKey) {
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

	// For streamed chat completions, ask the upstream to emit a final usage
	// chunk; otherwise streaming responses carry no token counts and we can't
	// compute cost. Don't clobber a caller-supplied stream_options.
	let outboundBody = body;
	if (stream && path.endsWith('/chat/completions') && isRecord(body)) {
		const existing = isRecord(body.stream_options) ? body.stream_options : {};
		outboundBody = { ...body, stream_options: { ...existing, include_usage: true } };
	}

	// proxy upstream
	let upstream: Response;
	try {
		upstream = await fetch(`${provider.baseUrl}${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${apiKey}`
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
			const usage = await readSseUsage(costBranch);
			const { estimateCostUsd } = await import('$lib/server/providers');
			const cost = usage
				? estimateCostUsd(model, usage.input, usage.output)
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
				latencyMs: Date.now() - started,
				ip,
				detail: 'stream'
			});
		})();
		return new Response(clientBranch, {
			status: upstream.status,
			headers: {
				'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
				'cache-control': 'no-cache'
			}
		});
	}

	// buffered response: parse usage for cost tracking
	const text = await upstream.text();
	let cost: number | null = null;
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
		cost = estimateCostUsd(model, inputTokens, outputTokens);
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
		latencyMs: Date.now() - started,
		ip
	});

	return new Response(text, {
		status: upstream.status,
		headers: { 'content-type': 'application/json' }
	});
}

export { loadProviderKey };
