import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listServices, createService } from '$lib/server/data';

export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);
	return json(await listServices());
};

export const POST: RequestHandler = async (event) => {
	await requirePermission(event, 'services:manage');
	const body = await event.request.json();
	if (!body?.name) return json({ error: 'name is required' }, { status: 400 });
	const row = await createService({
		name: body.name,
		type: body.type,
		description: body.description,
		policyId: body.policyId
	});
	return json(row, { status: 201 });
};
