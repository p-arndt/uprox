import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	const deployment = event.params.deployment;
	if (!deployment) return gatewayError(400, 'Missing deployment name');

	let body: { model?: string };
	try {
		body = await event.request.json();
	} catch {
		return gatewayError(400, 'Request body must be valid JSON');
	}

	const merged = { ...body, model: deployment };
	return proxyToProvider(event, {
		auth: auth.auth,
		scope: 'embeddings',
		model: deployment,
		path: '/embeddings',
		body: merged,
		stream: false,
		preferProvider: 'azure'
	});
};
