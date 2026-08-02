import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { updateOrgModelPrice, deleteOrgModelPrice } from '$lib/server/pricing';

/** Rates that may be cleared back to NULL (cache and long-context columns). */
const NULLABLE_RATES = [
	'cacheReadPerMtok',
	'cacheWritePerMtok',
	'longInputPerMtok',
	'longOutputPerMtok',
	'longCacheReadPerMtok',
	'longCacheWritePerMtok'
] as const;

export const PATCH: RequestHandler = async (event) => {
	await requirePermission(event, 'pricing:manage');
	const body = await event.request.json();
	const patch: Parameters<typeof updateOrgModelPrice>[1] = {};
	if (body.provider !== undefined) patch.provider = body.provider ? String(body.provider) : null;
	// input/output are required columns: present means a non-negative number.
	for (const key of ['inputPerMtok', 'outputPerMtok'] as const) {
		if (body[key] === undefined) continue;
		const n = Number(body[key]);
		if (!Number.isFinite(n) || n < 0) return json({ error: `invalid ${key}` }, { status: 400 });
		patch[key] = n;
	}
	// the rest are nullable: an explicit null clears the rate.
	for (const key of NULLABLE_RATES) {
		if (body[key] === undefined) continue;
		if (body[key] === null || body[key] === '') {
			patch[key] = null;
			continue;
		}
		const n = Number(body[key]);
		if (!Number.isFinite(n) || n < 0) return json({ error: `invalid ${key}` }, { status: 400 });
		patch[key] = n;
	}
	const row = await updateOrgModelPrice(event.params.id, patch);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	await requirePermission(event, 'pricing:manage');
	await deleteOrgModelPrice(event.params.id);
	return new Response(null, { status: 204 });
};
