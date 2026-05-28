import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure OpenAI's legacy Responses URL shape: `{endpoint}/openai/responses?
 * api-version=...`. `AsyncAzureOpenAI` builds this when `api_version` is a
 * date-stamped value (e.g. "2024-12-17") rather than "preview" / "v1", because
 * the Responses API has no deployment in the URL — the deployment name is sent
 * as the `model` field in the body. The `api-version` query is accepted and
 * ignored. Newer SDKs that set `api_version="preview"` hit `/openai/v1/responses`
 * instead, which is handled by the mirror route.
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
		scope: 'responses',
		model: body.model,
		path: '/responses',
		body,
		stream: body.stream === true,
		preferProvider: 'azure'
	});
};
