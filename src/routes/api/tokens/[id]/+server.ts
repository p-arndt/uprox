import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/org';
import { revokeToken } from '$lib/server/data';

// Revoke (soft-delete) a machine token.
export const DELETE: RequestHandler = async (event) => {
	const { organizationId } = await requirePermission(event, 'tokens:manage');
	const row = await revokeToken(organizationId, event.params.id);
	if (!row) return json({ error: 'Not found' }, { status: 404 });
	return json({ id: row.id, revokedAt: row.revokedAt });
};
