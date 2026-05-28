import type { RequestHandler } from './$types';
import { authenticateGateway, proxyRawUpstream } from '$lib/server/gateway';

/**
 * Azure OpenAI Files API at the legacy date-stamped surface
 * `{endpoint}/openai/files?api-version=…`. Routes to the org's Azure provider;
 * the `api-version` query is forwarded verbatim to the upstream.
 */
export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;
	return proxyRawUpstream(event, { auth: auth.auth, provider: 'azure', path: '/files' });
};

export const GET: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;
	return proxyRawUpstream(event, { auth: auth.auth, provider: 'azure', path: '/files' });
};
