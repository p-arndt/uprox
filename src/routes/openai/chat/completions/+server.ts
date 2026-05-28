import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure-style chat completions without a deployment in the URL. Most Azure
 * clients use `/openai/deployments/{deployment}/chat/completions`, but some SDK
 * configurations (and the newer Azure flat-routing variant) post here with the
 * deployment name in the body's `model` field.
 */
export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	let body: { model?: string; stream?: boolean };
	try {
		body = await event.request.json();
	} catch {
		return gatewayError(400, 'Request body must be valid JSON');
	}
	if (!body.model) return gatewayError(400, 'Missing required field: model');

	return proxyToProvider(event, {
		auth: auth.auth,
		scope: 'chat',
		model: body.model,
		path: '/chat/completions',
		body,
		stream: body.stream === true,
		preferProvider: 'azure'
	});
};
