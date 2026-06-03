import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

/**
 * OpenAI-compatible image generation (`POST /v1/images/generations`). Routes by
 * the body's `model` (e.g. `gpt-image-1`, `dall-e-3`); when both OpenAI and
 * Azure are configured the policy's preferredProvider breaks the tie. The
 * response is buffered, not streamed — image endpoints return a single JSON
 * payload (URLs or base64).
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
		stream: false
	});
};
