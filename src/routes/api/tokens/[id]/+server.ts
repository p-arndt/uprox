import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { revokeToken, updateToken } from '$lib/server/data';

// Edit a live token's access controls (name, scopes, model allowlist, policy).
export const PATCH: RequestHandler = async (event) => {
	await requirePermission(event, 'tokens:manage');
	const body = await event.request.json();
	const patch: Parameters<typeof updateToken>[1] = {};
	if (typeof body?.name === 'string') patch.name = body.name.trim();
	if (Array.isArray(body?.scopes)) patch.scopes = body.scopes.map((s: unknown) => String(s));
	if (Array.isArray(body?.allowedModels)) {
		patch.allowedModels = body.allowedModels.map((m: unknown) => String(m));
	}
	// explicit null clears the override (revert to the service policy)
	if (body?.policyId !== undefined) patch.policyId = body.policyId || null;
	const row = await updateToken(event.params.id, patch);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json({ id: row.id });
};

// Revoke (soft-delete) a machine token.
export const DELETE: RequestHandler = async (event) => {
	await requirePermission(event, 'tokens:manage');
	const row = await revokeToken(event.params.id);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json({ id: row.id, revokedAt: row.revokedAt });
};
