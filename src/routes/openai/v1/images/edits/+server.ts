import type { RequestHandler } from './$types';
import { authenticateGateway, proxyMultipartToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure OpenAI's newer OpenAI-compatible v1 surface for image editing, mirrored
 * under `/openai/v1/images/edits` so Azure-style clients hit the same gateway as
 * `/v1/images/edits`. `preferProvider: 'azure'` makes the URL-level intent win
 * over the policy's preferredProvider when both OpenAI and Azure are configured.
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
		scope: 'images',
		model,
		path: '/images/edits',
		form,
		preferProvider: 'azure'
	});
};
