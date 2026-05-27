import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import { listTokens, listServices, createToken, revokeToken } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	const [tokens, services] = await Promise.all([
		listTokens(organizationId),
		listServices(organizationId)
	]);
	return { tokens, services };
};

export const actions: Actions = {
	create: async (event) => {
		const { organizationId, userId } = await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const serviceId = data.get('serviceId')?.toString();
		const name = data.get('name')?.toString().trim();
		if (!serviceId) return fail(400, { message: 'Select a service' });
		if (!name) return fail(400, { message: 'Name is required' });

		const scopes = data.getAll('scopes').map((s) => s.toString());
		const days = Number(data.get('expiresInDays')) || 0;
		const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;

		try {
			const { plaintext } = await createToken(organizationId, userId, {
				serviceId,
				name,
				scopes,
				expiresAt
			});
			// returned to the page exactly once, then gone forever
			return { created: { name, plaintext } };
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Failed to create token' });
		}
	},
	revoke: async (event) => {
		const { organizationId } = await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await revokeToken(organizationId, id);
		return { success: true };
	}
};
