import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import { listPolicies, createPolicy, deletePolicy, updatePolicy } from '$lib/server/data';
import { PROVIDERS } from '$lib/server/providers';
import { inlineFromForm } from '$lib/server/parse-config';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	return {
		policies: await listPolicies(),
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }))
	};
};

/**
 * A preset's fields from the shared limits form. Unlike the inline overrides on
 * services and tokens, a preset's lists, rate limit and budgets are always set:
 * blank means "allow all" / unlimited (0). The cache TTL and tracing keep the
 * tri-state, where blank inherits the instance default.
 */
function policyFromForm(data: FormData) {
	const inline = inlineFromForm(data, { includeModels: true });
	return {
		allowedProviders: inline.allowedProviders ?? [],
		allowedModels: inline.allowedModels ?? [],
		preferredProvider: inline.preferredProvider ?? null,
		rateLimitPerMinute: inline.rateLimitPerMinute ?? 0,
		dailyBudgetUsd: inline.dailyBudgetUsd ?? 0,
		monthlyBudgetUsd: inline.monthlyBudgetUsd ?? 0,
		cacheTtlSeconds: inline.cacheTtlSeconds ?? null,
		tracingEnabled: inline.tracingEnabled ?? null
	};
}

export const actions: Actions = {
	create: async (event) => {
		await requirePermission(event, 'policies:manage');
		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });

		await createPolicy({ name, ...policyFromForm(data) });
		return { success: true };
	},
	update: async (event) => {
		await requirePermission(event, 'policies:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		const name = data.get('name')?.toString().trim();
		if (!id) return fail(400, { message: 'Missing id' });
		if (!name) return fail(400, { message: 'Name is required' });

		await updatePolicy(id, { name, ...policyFromForm(data) });
		return { success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'policies:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deletePolicy(id);
		return { success: true };
	}
};
