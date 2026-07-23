import type { RequestHandler } from './$types';
import { authenticateGateway, proxyMultipartToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure deployment-style audio transcription
 * (`POST /openai/deployments/{deployment}/audio/transcriptions`). The deployment
 * name in the URL is the model; it's written into the multipart form so routing
 * and pricing use it, and the request prefers the Azure backend.
 */
export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	const deployment = event.params.deployment;
	if (!deployment) return gatewayError(400, 'Missing deployment name');

	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		return gatewayError(400, 'Request body must be multipart/form-data');
	}
	form.set('model', deployment);

	return proxyMultipartToProvider(event, {
		auth: auth.auth,
		scope: 'transcriptions',
		model: deployment,
		path: '/audio/transcriptions',
		form,
		preferProvider: 'azure'
	});
};
