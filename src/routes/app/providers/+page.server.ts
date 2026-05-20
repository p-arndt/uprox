import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listProviderSecrets, upsertProviderSecret, deleteProviderSecret } from '$lib/server/data';
import { PROVIDERS, PROVIDER_IDS } from '$lib/server/providers';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	const secrets = await listProviderSecrets(organizationId);
	return {
		secrets,
		providers: Object.values(PROVIDERS).map((p) => ({
			id: p.id,
			label: p.label,
			baseUrl: p.baseUrl
		}))
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { organizationId, userId } = await requireOrg(event);
		const data = await event.request.formData();
		const provider = data.get('provider')?.toString() ?? '';
		const secret = data.get('secret')?.toString().trim() ?? '';
		if (!PROVIDER_IDS.includes(provider)) return fail(400, { message: 'Unknown provider' });
		if (!secret) return fail(400, { message: 'API key is required' });
		await upsertProviderSecret(organizationId, userId, {
			provider,
			secret,
			label: data.get('label')?.toString() || undefined
		});
		return { success: true };
	},
	delete: async (event) => {
		const { organizationId } = await requireOrg(event);
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteProviderSecret(organizationId, id);
		return { success: true };
	}
};
