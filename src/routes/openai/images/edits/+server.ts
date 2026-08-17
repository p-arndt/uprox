import type { RequestHandler } from './$types';
import { authenticateGateway, proxyMultipartToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure-style image editing without a deployment in the URL. Mirrors the
 * flat image-generation surface: some Azure SDK configurations post here with
 * the deployment name in the form's `model` field. `preferProvider: 'azure'`
 * forces Azure when both OpenAI and Azure are configured.
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
