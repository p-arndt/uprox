import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { updateService, deleteService } from '$lib/server/data';

export const PATCH: RequestHandler = async (event) => {
	const { organizationId } = await requirePermission(event, 'services:manage');
	const body = await event.request.json();
	const row = await updateService(organizationId, event.params.id, body);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requirePermission(event, 'services:manage');
	await deleteService(organizationId, event.params.id);
	return new Response(null, { status: 204 });
};
