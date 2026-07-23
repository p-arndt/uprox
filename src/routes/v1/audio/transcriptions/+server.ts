import type { RequestHandler } from './$types';
import { authenticateGateway, proxyMultipartToProvider, gatewayError } from '$lib/server/gateway';

/**
 * OpenAI-compatible audio transcription (`POST /v1/audio/transcriptions`).
 * Accepts multipart/form-data (the audio `file` plus a `model` field, e.g.
 * `whisper-1`, `gpt-4o-transcribe`) and routes by the form's `model`. The
 * multipart body is forwarded to the provider verbatim.
 */
export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		return gatewayError(400, 'Request body must be multipart/form-data');
	}

	const model = form.get('model');
	if (typeof model !== 'string' || !model) {
		return gatewayError(400, 'Missing required field: model');
	}

	return proxyMultipartToProvider(event, {
		auth: auth.auth,
		scope: 'transcriptions',
		model,
		path: '/audio/transcriptions',
		form
	});
};
