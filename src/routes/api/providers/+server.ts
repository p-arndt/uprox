import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listProviderSecrets, createProviderSecret } from '$lib/server/provider-secrets';
import { apiHandler } from '$lib/server/api/errors';
import { readJson } from '$lib/server/api/fields';
import { parseProviderCreate } from '$lib/server/api/provider-body';

export const GET: RequestHandler = apiHandler(async (event) => {
	await requireOrgApi(event);
	return json(await listProviderSecrets());
});

export const POST: RequestHandler = apiHandler(async (event) => {
	const { userId } = await requirePermission(event, 'providers:manage');
	const input = parseProviderCreate(await readJson(event.request));
	// returns `{ id, provider }` only: the secret is never echoed back
	return json(await createProviderSecret(userId, input), { status: 201 });
});
