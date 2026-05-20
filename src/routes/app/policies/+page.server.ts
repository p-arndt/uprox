import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listPolicies, createPolicy, deletePolicy } from '$lib/server/data';
import { PROVIDERS } from '$lib/server/providers';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	return {
		policies: await listPolicies(organizationId),
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }))
	};
};

export const actions: Actions = {
	create: async (event) => {
		const { organizationId } = await requireOrg(event);
		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });

		const allowedProviders = data.getAll('allowedProviders').map((p) => p.toString());
		const allowedModels = (data.get('allowedModels')?.toString() ?? '')
			.split(',')
			.map((m) => m.trim())
			.filter(Boolean);

		// blank cache field = inherit the org default (null); a number overrides it
		const rawCache = data.get('cacheTtlSeconds')?.toString().trim() ?? '';

		await createPolicy(organizationId, {
			name,
			allowedProviders,
			allowedModels,
			rateLimitPerMinute: Number(data.get('rateLimitPerMinute')) || 0,
			dailyBudgetUsd: Number(data.get('dailyBudgetUsd')) || 0,
			monthlyBudgetUsd: Number(data.get('monthlyBudgetUsd')) || 0,
			cacheTtlSeconds: rawCache === '' ? null : Number(rawCache) || 0
		});
		return { success: true };
	},
	delete: async (event) => {
		const { organizationId } = await requireOrg(event);
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deletePolicy(organizationId, id);
		return { success: true };
	}
};
