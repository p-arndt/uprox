import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { updateService, deleteService } from '$lib/server/data';
import { parseInlineConfig } from '$lib/server/parse-config';

export const PATCH: RequestHandler = async (event) => {
	await requirePermission(event, 'services:manage');
	const body = await event.request.json();
	// inline limits/access + the basic metadata fields (services have a model
	// allowlist of their own, so includeModels)
	const patch: Parameters<typeof updateService>[1] = parseInlineConfig(body ?? {}, {
		includeModels: true
	});
	if (typeof body?.name === 'string') patch.name = body.name.trim();
	if (typeof body?.type === 'string') patch.type = body.type.trim();
	if (body?.description !== undefined) patch.description = body.description || null;
	if (body?.policyId !== undefined) patch.policyId = body.policyId || null;
	if (body?.providerSecretId !== undefined) patch.providerSecretId = body.providerSecretId || null;
	const row = await updateService(event.params.id, patch);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	await requirePermission(event, 'services:manage');
	await deleteService(event.params.id);
	return new Response(null, { status: 204 });
};
