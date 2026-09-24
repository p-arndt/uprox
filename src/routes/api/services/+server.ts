import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import {
	listServices,
	createService,
	serviceNameTaken,
	SERVICE_NAME_TAKEN
} from '$lib/server/services';
import { ApiError, apiHandler } from '$lib/server/api/errors';
import { readJson } from '$lib/server/api/fields';
import { parseServiceCreate } from '$lib/server/api/service-body';

export const GET: RequestHandler = apiHandler(async (event) => {
	await requireOrgApi(event);
	return json(await listServices());
});

export const POST: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'services:manage');
	const input = parseServiceCreate(await readJson(event.request));
	if (await serviceNameTaken(input.name)) throw new ApiError(409, SERVICE_NAME_TAKEN, 'name');
	return json(await createService(input), { status: 201 });
});
