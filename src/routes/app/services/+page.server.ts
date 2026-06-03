import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listServices,
	createService,
	updateService,
	deleteService,
	listPolicies,
	listProviderSecrets
} from '$lib/server/data';
import { PROVIDERS } from '$lib/server/providers';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [services, policies, secrets] = await Promise.all([
		listServices(),
		listPolicies(),
		listProviderSecrets()
	]);
	// Options for the per-service "upstream key" picker. Only meaningful where a
	// provider has more than one key (e.g. several Azure resources); single-key
	// providers route automatically, so we leave them out to keep the list short.
	const counts = new Map<string, number>();
	for (const s of secrets) counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1);
	const providerSecrets = secrets
		.filter((s) => (counts.get(s.provider) ?? 0) > 1)
		.map((s) => ({
			id: s.id,
			provider: s.provider,
			providerLabel: PROVIDERS[s.provider]?.label ?? s.provider,
			label: s.label,
			hint: s.hint
		}));
	return { services, policies, providerSecrets };
};

export const actions: Actions = {
	create: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });
		await createService({
			name,
			type: data.get('type')?.toString() || 'app',
			description: data.get('description')?.toString() || undefined,
			policyId: data.get('policyId')?.toString() || null,
			providerSecretId: data.get('providerSecretId')?.toString() || null
		});
		return { success: true };
	},
	update: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });
		await updateService(id ?? '', {
			name,
			type: data.get('type')?.toString() || 'app',
			description: data.get('description')?.toString() || null,
			policyId: data.get('policyId')?.toString() || null,
			providerSecretId: data.get('providerSecretId')?.toString() || null
		});
		return { success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteService(id);
		return { success: true };
	}
};
