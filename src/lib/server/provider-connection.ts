/**
 * "Test connection" for a provider credential: one cheap, auth-checking call to
 * the upstream (its model listing) before a key is saved or on demand, so a typo
 * in a key or endpoint shows up in the dialog instead of on the first proxied
 * request.
 */
import { getAdapter } from '$lib/server/adapters';
import {
	authHeaders,
	providerSupports,
	resolveBaseUrl,
	type ProviderDef
} from '$lib/server/providers';

import type { ConnectionTestOutcome } from '$lib/features/providers/providers';

/** `skipped` means the provider can't be probed (no model listing / no endpoint); not an error. */
export type ConnectionTestResult = ConnectionTestOutcome;

/** Short on purpose: the operator is waiting on a dialog. */
export const CONNECTION_TEST_TIMEOUT_MS = 5_000;

/** Longest upstream error text surfaced in the UI; bodies can be whole HTML pages. */
const MAX_MESSAGE_LENGTH = 300;

/**
 * The request that probes a credential, or null when the provider can't be
 * tested. Listing models is free on every supported provider and rejects a bad
 * key, which makes it the cheapest check that actually exercises auth.
 */
export function connectionTestRequest(
	def: ProviderDef,
	secret: string,
	endpoint: string | null
): { url: string; headers: Record<string, string> } | null {
	if (!providerSupports(def, 'models')) return null;
	const baseUrl = resolveBaseUrl(def, endpoint);
	if (!baseUrl) return null;
	const url = getAdapter(def.id)?.modelsUrl(baseUrl) ?? `${baseUrl}/models`;
	return { url, headers: { accept: 'application/json', ...authHeaders(def, secret) } };
}

/**
 * A readable message from an upstream error body. Providers nest it differently
 * (OpenAI/Anthropic `{error:{message}}`, Gemini the same shape, others a bare
 * `{message}` or `{error: "…"}`), so try those before falling back to raw text.
 */
export function upstreamErrorMessage(status: number, statusText: string, body: string): string {
	let detail = '';
	try {
		const json: unknown = JSON.parse(body);
		if (json && typeof json === 'object') {
			const j = json as Record<string, unknown>;
			const err = j.error;
			if (typeof err === 'string') detail = err;
			else if (
				err &&
				typeof err === 'object' &&
				typeof (err as { message?: unknown }).message === 'string'
			)
				detail = (err as { message: string }).message;
			else if (typeof j.message === 'string') detail = j.message;
		}
	} catch {
		// not JSON: an HTML error page tells the operator nothing useful
		if (!/^\s*</.test(body)) detail = body.trim();
	}
	const head = `${status}${statusText ? ` ${statusText}` : ''}`;
	const full = detail ? `Upstream returned ${head}: ${detail}` : `Upstream returned ${head}`;
	return full.length > MAX_MESSAGE_LENGTH ? `${full.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : full;
}

/** Why a fetch threw, in operator terms. */
function networkErrorMessage(err: unknown, url: string, timeoutMs: number): string {
	const name = err instanceof Error ? err.name : '';
	if (name === 'TimeoutError' || name === 'AbortError')
		return `No response from ${hostOf(url)} within ${timeoutMs / 1000}s`;
	const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
	const reason = cause ?? (err instanceof Error ? err.message : String(err));
	return `Could not reach ${hostOf(url)}: ${reason}`;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** Probe a credential against its upstream. Never throws. */
export async function testProviderConnection(
	def: ProviderDef,
	secret: string,
	endpoint: string | null,
	opts: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<ConnectionTestResult> {
	const req = connectionTestRequest(def, secret, endpoint);
	if (!req) return { status: 'skipped', message: `${def.label} can't be tested automatically` };
	const fetchFn = opts.fetch ?? fetch;
	const timeoutMs = opts.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS;
	let res: Response;
	try {
		res = await fetchFn(req.url, {
			method: 'GET',
			headers: req.headers,
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (err) {
		return { status: 'failed', message: networkErrorMessage(err, req.url, timeoutMs) };
	}
	if (res.ok) {
		// drain so the connection can be reused
		await res.body?.cancel().catch(() => {});
		return { status: 'ok' };
	}
	const body = await res.text().catch(() => '');
	return { status: 'failed', message: upstreamErrorMessage(res.status, res.statusText, body) };
}
