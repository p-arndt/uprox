import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getOrgSettings, updateOrgSettings } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	return { settings: await getOrgSettings(organizationId) };
};

export const actions: Actions = {
	updateCache: async (event) => {
		const { organizationId } = await requireOrg(event);
		const data = await event.request.formData();
		const ttl = Number(data.get('cacheTtlSeconds'));
		if (!Number.isFinite(ttl) || ttl < 0) {
			return fail(400, { message: 'Cache TTL must be a non-negative number' });
		}
		await updateOrgSettings(organizationId, { cacheTtlSeconds: ttl });
		return { success: true };
	}
};
