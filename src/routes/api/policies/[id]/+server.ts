import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { updatePolicy, deletePolicy } from '$lib/server/data';

export const PATCH: RequestHandler = async (event) => {
	await requirePermission(event, 'policies:manage');
	const body = await event.request.json();
	const row = await updatePolicy(event.params.id, body);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	await requirePermission(event, 'policies:manage');
	await deletePolicy(event.params.id);
	return new Response(null, { status: 204 });
};
