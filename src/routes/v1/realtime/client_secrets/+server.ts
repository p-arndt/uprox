import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

// Routing fallback when the request carries no model (a transcription-type
// session may omit it). Only picks the provider — the body is forwarded
// unchanged, so the upstream still sees exactly what the client sent.
const ROUTING_FALLBACK_MODEL = 'gpt-realtime';

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Mint an ephemeral Realtime **client secret** (`POST /v1/realtime/client_secrets`).
 * The client then opens the Realtime connection (WebRTC/WebSocket) to OpenAI
 * directly with the short-lived token — so the provider key stays sealed in
 * uprox. The model lives at `session.model` in the current API (top-level
 * `model` on the legacy shape); we route by whichever is present.
 *
 * Note: the actual audio/token usage happens on the client's direct connection,
 * outside the gateway, so these requests can't be metered here — only the token
 * mint is audited (cost 0).
 */
export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		return gatewayError(400, 'Request body must be valid JSON');
	}

	const session = isRecord(body) && isRecord(body.session) ? body.session : undefined;
	const model =
		(session && typeof session.model === 'string' && session.model) ||
		(isRecord(body) && typeof body.model === 'string' && body.model) ||
		ROUTING_FALLBACK_MODEL;

	return proxyToProvider(event, {
		auth: auth.auth,
		scope: 'realtime',
		model,
		path: '/realtime/client_secrets',
		body,
		stream: false
	});
};
