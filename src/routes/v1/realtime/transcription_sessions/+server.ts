import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

// A transcription session's model lives under input_audio_transcription.model,
// and may be omitted entirely; this fallback only selects the provider.
const ROUTING_FALLBACK_MODEL = 'gpt-realtime';

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Legacy Realtime **transcription** ephemeral-token endpoint
 * (`POST /v1/realtime/transcription_sessions`) — mints a client secret scoped
 * to a realtime speech-to-text session. Model (when present) is nested under
 * `input_audio_transcription.model`. See client_secrets for the metering caveat.
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

	const transcription =
		isRecord(body) && isRecord(body.input_audio_transcription)
			? body.input_audio_transcription
			: undefined;
	const model =
		(transcription && typeof transcription.model === 'string' && transcription.model) ||
		(isRecord(body) && typeof body.model === 'string' && body.model) ||
		ROUTING_FALLBACK_MODEL;

	return proxyToProvider(event, {
		auth: auth.auth,
		scope: 'realtime',
		model,
		path: '/realtime/transcription_sessions',
		body,
		stream: false
	});
};
