import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

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
		scope: 'embeddings',
		model: body.model,
		path: '/embeddings',
		body,
		stream: false,
		preferProvider: 'azure'
	});
};
