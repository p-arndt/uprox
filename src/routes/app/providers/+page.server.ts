import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listProviderSecrets,
	createProviderSecret,
	updateProviderSecret,
	deleteProviderSecret
} from '$lib/server/data';
import { PROVIDERS, PROVIDER_IDS } from '$lib/server/providers';

/** Parse a priority form field to a finite integer, defaulting to 0. */
function parsePriority(raw: FormDataEntryValue | null): number {
	const n = Number.parseInt(raw?.toString() ?? '', 10);
	return Number.isFinite(n) ? n : 0;
}

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const secrets = await listProviderSecrets();
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
	// add a new secret for a provider (a provider may hold several, e.g. one per
	// Azure OpenAI resource)
	create: async (event) => {
		const { userId } = await requirePermission(event, 'providers:manage');
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
		await createProviderSecret(userId, {
			provider,
			secret,
			label: data.get('label')?.toString() || undefined,
			baseUrl,
			priority: parsePriority(data.get('priority'))
		});
		return { success: true };
	},
	// rotate the key of an existing secret in place
	rotate: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString() ?? '';
		const secret = data.get('secret')?.toString().trim() ?? '';
		if (!id) return fail(400, { message: 'Missing provider secret id' });
		if (!secret) return fail(400, { message: 'API key is required' });
		await updateProviderSecret(id, { secret });
		return { success: true };
	},
	// edit a secret's label / endpoint / priority (the key is left unchanged)
	editMeta: async (event) => {
		await requirePermission(event, 'providers:manage');
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
		await updateProviderSecret(id, {
			label: label || null,
			baseUrl: baseUrl || null,
			priority: parsePriority(data.get('priority'))
		});
		return { success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteProviderSecret(id);
		return { success: true };
	}
};
