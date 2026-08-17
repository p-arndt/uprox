import type { RequestHandler } from './$types';
import { authenticateGateway, proxyMultipartToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure OpenAI legacy URL surface for image editing. The Azure SDK calls
 * `POST {endpoint}/openai/deployments/{deployment}/images/edits?api-version=...`
 * with the deployment name in the path. We treat the URL deployment as the
 * canonical model name and write it into the multipart form (Azure clients
 * typically omit `model` there), so routing and pricing use it. The
 * `api-version` query string is forwarded but otherwise ignored by uprox.
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
		scope: 'images',
		model: deployment,
		path: '/images/edits',
		form,
		preferProvider: 'azure'
	});
};
