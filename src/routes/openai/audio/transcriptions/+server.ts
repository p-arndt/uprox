import type { RequestHandler } from './$types';
import { authenticateGateway, proxyMultipartToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure-style ingress for audio transcription (`POST /openai/audio/transcriptions`).
 * Same multipart contract as `/v1/audio/transcriptions`, but the URL signals
 * Azure intent so the request prefers the Azure backend when both are configured.
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
		form,
		preferProvider: 'azure'
	});
};
