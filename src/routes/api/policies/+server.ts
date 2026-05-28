import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listPolicies, createPolicy } from '$lib/server/data';

export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);
	return json(await listPolicies());
};

export const POST: RequestHandler = async (event) => {
	await requirePermission(event, 'policies:manage');
	const body = await event.request.json();
	if (!body?.name) return json({ error: 'name is required' }, { status: 400 });
	const row = await createPolicy({
		name: body.name,
		allowedProviders: Array.isArray(body.allowedProviders) ? body.allowedProviders : [],
		allowedModels: Array.isArray(body.allowedModels) ? body.allowedModels : [],
		rateLimitPerMinute: Number(body.rateLimitPerMinute) || 0,
		dailyBudgetUsd: Number(body.dailyBudgetUsd) || 0,
		monthlyBudgetUsd: Number(body.monthlyBudgetUsd) || 0,
		// null/absent = inherit the org default; a number overrides it
		cacheTtlSeconds: body.cacheTtlSeconds == null ? null : Number(body.cacheTtlSeconds) || 0
	});
	return json(row, { status: 201 });
};
