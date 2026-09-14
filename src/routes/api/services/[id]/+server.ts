import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { updateService, deleteService } from '$lib/server/data';
import { apiHandler, notFound } from '$lib/server/api/errors';
import { pathId, readJson } from '$lib/server/api/fields';
import { parseServicePatch } from '$lib/server/api/service-body';

export const PATCH: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'services:manage');
	const id = pathId(event.params.id);
	const patch = parseServicePatch(await readJson(event.request));
	const row = await updateService(id, patch);
	if (!row) throw notFound();
	return json(row);
});

// Retire (soft-delete) a service and revoke its tokens.
export const DELETE: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'services:manage');
	await deleteService(pathId(event.params.id));
	return new Response(null, { status: 204 });
});
