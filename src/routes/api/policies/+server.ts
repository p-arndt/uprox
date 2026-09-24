import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import {
	listPolicies,
	createPolicy,
	policyNameTaken,
	POLICY_NAME_TAKEN
} from '$lib/server/policies';
import { ApiError, apiHandler } from '$lib/server/api/errors';
import { readJson } from '$lib/server/api/fields';
import { parsePolicyCreate } from '$lib/server/api/policy-body';

export const GET: RequestHandler = apiHandler(async (event) => {
	await requireOrgApi(event);
	return json(await listPolicies());
});

export const POST: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'policies:manage');
	const input = parsePolicyCreate(await readJson(event.request));
	if (await policyNameTaken(input.name)) throw new ApiError(409, POLICY_NAME_TAKEN, 'name');
	return json(await createPolicy(input), { status: 201 });
});
