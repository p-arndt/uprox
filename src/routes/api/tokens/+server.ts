import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listTokens, createToken } from '$lib/server/data';

export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);
	return json(await listTokens());
};

export const POST: RequestHandler = async (event) => {
	const { userId } = await requirePermission(event, 'tokens:manage');
	const body = await event.request.json();
	if (!body?.serviceId || !body?.name) {
		return json({ error: 'serviceId and name are required' }, { status: 400 });
	}
	try {
		const { token, plaintext } = await createToken(userId, {
			serviceId: body.serviceId,
			name: body.name,
			scopes: Array.isArray(body.scopes) ? body.scopes : [],
			expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
		});
		// `token` (the plaintext) is returned exactly once and never persisted.
		return json({ ...token, token: plaintext }, { status: 201 });
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : 'failed' }, { status: 400 });
	}
};
