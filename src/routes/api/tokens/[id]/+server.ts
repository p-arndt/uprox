import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { revokeToken } from '$lib/server/data';

// Revoke (soft-delete) a machine token.
export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	const row = await revokeToken(organizationId, event.params.id);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json({ id: row.id, revokedAt: row.revokedAt });
};
