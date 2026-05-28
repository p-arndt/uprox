import type { RequestHandler } from './$types';
import { authenticateGateway, proxyRawUpstream, gatewayError } from '$lib/server/gateway';

export const GET: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;
	const id = event.params.id;
	if (!id) return gatewayError(400, 'Missing file id');
	return proxyRawUpstream(event, {
		auth: auth.auth,
		provider: 'azure',
		path: `/files/${encodeURIComponent(id)}/content`
	});
};
