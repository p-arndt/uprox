import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listEffectiveModelPrices, createOrgModelPrice } from '$lib/server/pricing';
import { apiHandler } from '$lib/server/api/errors';
import { readJson } from '$lib/server/api/fields';
import { parsePricingCreate } from '$lib/server/api/pricing-body';

export const GET: RequestHandler = apiHandler(async (event) => {
	await requireOrgApi(event);
	return json(await listEffectiveModelPrices());
});

export const POST: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'pricing:manage');
	const input = parsePricingCreate(await readJson(event.request));
	return json(await createOrgModelPrice(input), { status: 201 });
});
