import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { deleteProviderSecret } from '$lib/server/provider-secrets';
import { apiHandler } from '$lib/server/api/errors';
import { pathId } from '$lib/server/api/fields';

export const DELETE: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'providers:manage');
	await deleteProviderSecret(pathId(event.params.id));
	return new Response(null, { status: 204 });
});
