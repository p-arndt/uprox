import type { RequestHandler } from './$types';
import { authenticateGateway, proxyMultipartToProvider, gatewayError } from '$lib/server/gateway';

/**
 * OpenAI-compatible image editing (`POST /v1/images/edits`). Unlike
 * `/v1/images/generations` this is a multipart endpoint: the form carries one or
 * more source images (`image` / `image[]`), an optional `mask`, the `prompt` and
 * the `model` (e.g. `gpt-image-1`) it routes by. The form is forwarded verbatim
 * so the uploaded bytes survive with their boundary intact; the response is
 * buffered, not streamed (gpt-image-1's `partial_images` SSE flavour isn't
 * supported through the gateway).
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
		form
	});
};
