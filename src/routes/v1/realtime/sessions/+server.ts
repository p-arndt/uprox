import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';
import { isRecord } from '$lib/server/json';

const ROUTING_FALLBACK_MODEL = 'gpt-realtime';

/**
 * Legacy Realtime ephemeral-token endpoint (`POST /v1/realtime/sessions`),
 * superseded by `/realtime/client_secrets` but still used by older SDKs. The
 * model is top-level here. See client_secrets for the metering caveat.
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

	const model =
		(isRecord(body) && typeof body.model === 'string' && body.model) || ROUTING_FALLBACK_MODEL;

	return proxyToProvider(event, {
		auth: auth.auth,
		scope: 'realtime',
		model,
		path: '/realtime/sessions',
		body,
		stream: false
	});
};
