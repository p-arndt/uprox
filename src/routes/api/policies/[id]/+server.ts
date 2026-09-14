import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { updatePolicy, deletePolicy } from '$lib/server/data';
import { apiHandler, notFound } from '$lib/server/api/errors';
import { pathId, readJson } from '$lib/server/api/fields';
import { parsePolicyPatch } from '$lib/server/api/policy-body';

export const PATCH: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'policies:manage');
	const id = pathId(event.params.id);
	const patch = parsePolicyPatch(await readJson(event.request));
	const row = await updatePolicy(id, patch);
	if (!row) throw notFound();
	return json(row);
});

export const DELETE: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'policies:manage');
	await deletePolicy(pathId(event.params.id));
	return new Response(null, { status: 204 });
});
