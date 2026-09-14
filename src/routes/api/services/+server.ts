import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listServices, createService } from '$lib/server/services';
import { apiHandler } from '$lib/server/api/errors';
import { readJson } from '$lib/server/api/fields';
import { parseServiceCreate } from '$lib/server/api/service-body';

export const GET: RequestHandler = apiHandler(async (event) => {
	await requireOrgApi(event);
	return json(await listServices());
});

export const POST: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'services:manage');
	const input = parseServiceCreate(await readJson(event.request));
	return json(await createService(input), { status: 201 });
});
