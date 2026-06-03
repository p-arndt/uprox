import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure OpenAI's newer OpenAI-compatible v1 surface for image generation,
 * mirrored under `/openai/v1/images/generations` so Azure-style clients hit the
 * same gateway as `/v1/images/generations`. `preferProvider: 'azure'` makes the
 * URL-level intent win over the policy's preferredProvider when both OpenAI and
 * Azure are configured.
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
