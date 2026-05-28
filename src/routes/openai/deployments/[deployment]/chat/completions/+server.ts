import type { RequestHandler } from './$types';
import { authenticateGateway, proxyToProvider, gatewayError } from '$lib/server/gateway';

/**
 * Azure OpenAI legacy URL surface. The Azure SDK calls
 * `POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=...`
 * with the deployment name in the path. We treat the URL deployment as the
 * canonical model name (overriding any `model` in the body, which Azure clients
 * typically omit) and feed it through the same proxy as `/v1/chat/completions`.
 * Routing then picks Azure via `acceptsAnyModel` when no other provider claims
 * the prefix. The `api-version` query string is ignored — uprox doesn't care.
 */
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
		scope: 'chat',
		model: deployment,
		path: '/chat/completions',
		body: merged,
		stream: body.stream === true,
		preferProvider: 'azure'
	});
};
