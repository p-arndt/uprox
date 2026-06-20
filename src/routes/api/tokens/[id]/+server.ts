import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { revokeToken, updateToken } from '$lib/server/data';
import { parseInlineConfig } from '$lib/server/parse-config';

// Edit a live token's access controls + inline limits (name, scopes, model
// allowlist, preset, and any per-token overrides).
export const PATCH: RequestHandler = async (event) => {
	await requirePermission(event, 'tokens:manage');
	const body = await event.request.json();
	// token keeps its own allowedModels handling (non-null), so exclude it here
	const patch: Parameters<typeof updateToken>[1] = parseInlineConfig(body ?? {});
	if (typeof body?.name === 'string') patch.name = body.name.trim();
	if (Array.isArray(body?.scopes)) patch.scopes = body.scopes.map((s: unknown) => String(s));
	if (Array.isArray(body?.allowedModels)) {
		patch.allowedModels = body.allowedModels.map((m: unknown) => String(m));
	}
	// explicit null clears the override (revert to inheriting the preset/service)
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
