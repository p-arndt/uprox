import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure-style image generation without a deployment in the URL. Mirrors the
 * chat-completions flat surface: some Azure SDK configurations post here with
 * the deployment name in the body's `model` field. `preferProvider: 'azure'`
 * forces Azure when both OpenAI and Azure are configured.
 */
export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	let body: { model?: string };
	try {
		body = await event.request.json();
	} catch {
		return gatewayError(400, 'Request body must be valid JSON');
	}
	if (!body.model) return gatewayError(400, 'Missing required field: model');

	return proxyToProvider(event, {
		auth: auth.auth,
		scope: 'images',
		model: body.model,
		path: '/images/generations',
		body,
		stream: false,
		preferProvider: 'azure'
	});
};
