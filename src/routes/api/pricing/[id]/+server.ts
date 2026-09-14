import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { updateOrgModelPrice, deleteOrgModelPrice } from '$lib/server/pricing';
import { apiHandler, notFound } from '$lib/server/api/errors';
import { pathId, readJson } from '$lib/server/api/fields';
import { parsePricingPatch } from '$lib/server/api/pricing-body';

export const PATCH: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'pricing:manage');
	const id = pathId(event.params.id);
	const patch = parsePricingPatch(await readJson(event.request));
	const row = await updateOrgModelPrice(id, patch);
	if (!row) throw notFound();
	return json(row);
});

export const DELETE: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'pricing:manage');
	await deleteOrgModelPrice(pathId(event.params.id));
	return new Response(null, { status: 204 });
});
