import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { listPolicies, createPolicy } from '$lib/server/data';

export const GET: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	return json(await listPolicies(organizationId));
};

export const POST: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	const body = await event.request.json();
	if (!body?.name) return json({ error: 'name is required' }, { status: 400 });
	const row = await createPolicy(organizationId, {
		name: body.name,
		allowedProviders: Array.isArray(body.allowedProviders) ? body.allowedProviders : [],
		allowedModels: Array.isArray(body.allowedModels) ? body.allowedModels : [],
		rateLimitPerMinute: Number(body.rateLimitPerMinute) || 0
	});
	return json(row, { status: 201 });
};
