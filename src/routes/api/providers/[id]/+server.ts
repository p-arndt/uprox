import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { deleteProviderSecret } from '$lib/server/data';

export const DELETE: RequestHandler = async (event) => {
	await requirePermission(event, 'providers:manage');
	await deleteProviderSecret(event.params.id);
	return new Response(null, { status: 204 });
};
