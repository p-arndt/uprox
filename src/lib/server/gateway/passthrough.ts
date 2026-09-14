/** Non-billable pass-through: native Gemini model discovery and the Files API. */
import { json, type RequestEvent } from '@sveltejs/kit';
import { evaluatePolicy } from '$lib/server/policy';
import { authHeaders, PROVIDERS, resolveBaseUrl } from '$lib/server/providers';
import { audit } from '$lib/server/audit';
import { isRecord } from '$lib/server/json';
import { gatewayError, geminiNativeError } from './envelope';
import type { GatewayAuth } from './authenticate';
import { loadProviderCreds } from './credentials';
import { SAFE_MODEL_NAME } from './pipeline';

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

	// defense-in-depth: `model` is interpolated raw into the upstream URL below, so
	// reject anything outside a safe model-name charset (only for the get call —
	// `model` is null for the list call).
	if (model && !SAFE_MODEL_NAME.test(model)) {
		return geminiNativeError(404, `Model "${model}" is not available`, 'NOT_FOUND');
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
		upstream = await fetch(url, {
			headers: authHeaders(provider, creds.apiKey),
			signal: event.request.signal
		});
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

	// policy enforcement: the Files API has no model to scope by, so we gate on the
	// 'files' scope (and the policy's provider allowlist). An empty model skips the
	// model rules, so a token with no explicit scopes is still allowed — only a
	// token whose explicit scope list omits 'files', or a policy whose
	// allowedProviders excludes this provider, is denied.
	const decision = evaluatePolicy(token, { provider: providerId, model: '', scope: 'files' });
	if (!decision.allow) {
		await audit({
			action: 'policy.deny',
			status: 'deny',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 403,
			ip,
			detail: decision.reason
		});
		return gatewayError(403, `Request denied by policy: ${decision.reason}`, 'permission_error');
	}

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
			signal: event.request.signal,
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
