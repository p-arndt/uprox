import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listProviderSecrets,
	upsertProviderSecret,
	updateProviderSecret,
	deleteProviderSecret
} from '$lib/server/data';
import { PROVIDERS, PROVIDER_IDS } from '$lib/server/providers';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	const secrets = await listProviderSecrets(organizationId);
	return {
		secrets,
		providers: Object.values(PROVIDERS).map((p) => ({
			id: p.id,
			label: p.label,
			baseUrl: p.baseUrl,
			// providers whose endpoint is per-org (Azure) need an endpoint field
			requiresEndpoint: p.requiresEndpoint ?? false
		}))
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { organizationId, userId } = await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const provider = data.get('provider')?.toString() ?? '';
		const secret = data.get('secret')?.toString().trim() ?? '';
		const baseUrl = data.get('baseUrl')?.toString().trim() || undefined;
		if (!PROVIDER_IDS.includes(provider)) return fail(400, { message: 'Unknown provider' });
		if (!secret) return fail(400, { message: 'API key is required' });
		const def = PROVIDERS[provider];
		if (def.requiresEndpoint) {
			if (!baseUrl) return fail(400, { message: `${def.label} requires an endpoint URL` });
			if (!/^https:\/\//i.test(baseUrl))
				return fail(400, { message: 'Endpoint must be an https:// URL' });
		}
		await upsertProviderSecret(organizationId, userId, {
			provider,
			secret,
			label: data.get('label')?.toString() || undefined,
			baseUrl
		});
		return { success: true };
	},
	editMeta: async (event) => {
		const { organizationId } = await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString() ?? '';
		const provider = data.get('provider')?.toString() ?? '';
		const label = data.get('label')?.toString().trim() || undefined;
		const baseUrl = data.get('baseUrl')?.toString().trim() || undefined;
		if (!id) return fail(400, { message: 'Missing provider secret id' });
		const def = PROVIDERS[provider];
		if (def?.requiresEndpoint) {
			if (!baseUrl) return fail(400, { message: `${def.label} requires an endpoint URL` });
			if (!/^https:\/\//i.test(baseUrl))
				return fail(400, { message: 'Endpoint must be an https:// URL' });
		}
		await updateProviderSecret(organizationId, id, {
			label: label || null,
			baseUrl: baseUrl || null
		});
		return { success: true };
	},
	delete: async (event) => {
		const { organizationId } = await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteProviderSecret(organizationId, id);
		return { success: true };
	}
};
