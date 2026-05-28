import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	const deployment = event.params.deployment;
	if (!deployment) return gatewayError(400, 'Missing deployment name');

	let body: { model?: string; stream?: boolean };
	try {
		body = await event.request.json();
	} catch {
		return gatewayError(400, 'Request body must be valid JSON');
	}

	const merged = { ...body, model: deployment };
	return proxyToProvider(event, {
		auth: auth.auth,
		scope: 'responses',
		model: deployment,
		path: '/responses',
		body: merged,
		stream: body.stream === true,
		preferProvider: 'azure'
	});
};
