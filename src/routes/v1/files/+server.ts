import type { RequestHandler } from './$types';
import { authenticateGateway, proxyRawUpstream } from '$lib/server/gateway';

/**
 * OpenAI Files API — list (GET) and upload (POST). The OpenAI Python SDK
 * sometimes auto-uploads large image inputs to the Files API before referencing
 * them by `file_id` in a Responses call, so this needs to work for vision
 * requests to land successfully.
 */
export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;
	return proxyRawUpstream(event, { auth: auth.auth, provider: 'openai', path: '/files' });
};

export const GET: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;
	return proxyRawUpstream(event, { auth: auth.auth, provider: 'openai', path: '/files' });
};
