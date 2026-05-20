import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { updatePolicy, deletePolicy } from '$lib/server/data';

export const PATCH: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	const body = await event.request.json();
	const row = await updatePolicy(organizationId, event.params.id, body);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	await deletePolicy(organizationId, event.params.id);
	return new Response(null, { status: 204 });
};
