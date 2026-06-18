import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGateway, proxyGeminiModels } from '$lib/server/gateway';

/**
 * Native Gemini model listing — `GET /v1beta/models`, the Google GenAI SDK's
 * `ai.models.list()`. Proxies to Gemini and returns the native list shape,
 * filtered to the models this token's policy allows. Pagination query params
 * (`pageSize`, `pageToken`) are forwarded; `nextPageToken` is passed back.
 */
export const GET: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) {
		return json(
			{ error: { code: 401, message: 'Missing or invalid API key', status: 'UNAUTHENTICATED' } },
			{ status: 401 }
		);
	}
	return proxyGeminiModels(event, auth.auth, null);
};
