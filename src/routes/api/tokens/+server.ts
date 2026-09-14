import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listTokens, createToken } from '$lib/server/data';
import { apiHandler, badRequest } from '$lib/server/api/errors';
import { readJson } from '$lib/server/api/fields';
import { parseTokenCreate, tokenResponse } from '$lib/server/api/token-body';

export const GET: RequestHandler = apiHandler(async (event) => {
	await requireOrgApi(event);
	return json(await listTokens());
});

export const POST: RequestHandler = apiHandler(async (event) => {
	const { userId } = await requirePermission(event, 'tokens:manage');
	const input = parseTokenCreate(await readJson(event.request));
	const created = await createToken(userId, input).catch((err: unknown) => {
		// the only domain error createToken raises: an unknown or retired serviceId
		if (err instanceof Error && err.message === 'Service not found') {
			throw badRequest('Service not found', 'serviceId');
		}
		throw err;
	});
	// `token` (the plaintext) is returned exactly once and never persisted.
	return json({ ...tokenResponse(created.token), token: created.plaintext }, { status: 201 });
});
