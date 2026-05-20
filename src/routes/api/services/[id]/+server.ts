import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { updateService, deleteService } from '$lib/server/data';

export const PATCH: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	const body = await event.request.json();
	const row = await updateService(organizationId, event.params.id, body);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	await deleteService(organizationId, event.params.id);
	return new Response(null, { status: 204 });
};
