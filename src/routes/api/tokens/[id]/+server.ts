import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { revokeToken, updateToken } from '$lib/server/tokens-admin';
import { apiHandler, notFound } from '$lib/server/api/errors';
import { pathId, readJson } from '$lib/server/api/fields';
import { parseTokenPatch, tokenResponse } from '$lib/server/api/token-body';

// Edit a live token's access controls + inline limits (name, scopes, model
// allowlist, preset, and any per-token overrides). Revoked tokens are a 404.
export const PATCH: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'tokens:manage');
	const id = pathId(event.params.id);
	const patch = parseTokenPatch(await readJson(event.request));
	const row = await updateToken(id, patch);
	if (!row) throw notFound();
	return json(tokenResponse(row));
});

// Revoke (soft-delete) a machine token. Unlike the other DELETE routes this
// answers 200 with `{ id, revokedAt }`, which existing clients rely on.
export const DELETE: RequestHandler = apiHandler(async (event) => {
	await requirePermission(event, 'tokens:manage');
	const row = await revokeToken(pathId(event.params.id));
	if (!row) throw notFound();
	return json({ id: row.id, revokedAt: row.revokedAt });
});
