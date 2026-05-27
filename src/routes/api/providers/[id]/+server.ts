import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { deleteProviderSecret } from '$lib/server/data';

export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requirePermission(event, 'providers:manage');
	await deleteProviderSecret(organizationId, event.params.id);
	return new Response(null, { status: 204 });
};
