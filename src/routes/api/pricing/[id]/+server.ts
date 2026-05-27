import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { updateOrgModelPrice, deleteOrgModelPrice } from '$lib/server/pricing';

export const PATCH: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	const body = await event.request.json();
	const patch: { provider?: string | null; inputPerMtok?: number; outputPerMtok?: number } = {};
	if (body.provider !== undefined) patch.provider = body.provider ? String(body.provider) : null;
	if (body.inputPerMtok !== undefined) {
		const n = Number(body.inputPerMtok);
		if (!Number.isFinite(n) || n < 0)
			return json({ error: 'invalid inputPerMtok' }, { status: 400 });
		patch.inputPerMtok = n;
	}
	if (body.outputPerMtok !== undefined) {
		const n = Number(body.outputPerMtok);
		if (!Number.isFinite(n) || n < 0)
			return json({ error: 'invalid outputPerMtok' }, { status: 400 });
		patch.outputPerMtok = n;
	}
	const row = await updateOrgModelPrice(organizationId, event.params.id, patch);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	await deleteOrgModelPrice(organizationId, event.params.id);
	return new Response(null, { status: 204 });
};
