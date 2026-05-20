import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { deleteProviderSecret } from '$lib/server/data';

export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	await deleteProviderSecret(organizationId, event.params.id);
	return new Response(null, { status: 204 });
};
