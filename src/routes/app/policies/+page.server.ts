import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listPolicies,
	createPolicy,
	deletePolicy,
	updatePolicy,
	policyUsageCounts,
	policyNameTaken,
	knownModelIds,
	POLICY_NAME_TAKEN
} from '$lib/server/policies';
import { PROVIDERS } from '$lib/server/providers';
import { parsePolicyForm, unknownModelsWarning } from './policy-form.server';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [rows, usage, modelSuggestions] = await Promise.all([
		listPolicies(),
		policyUsageCounts(),
		knownModelIds()
	]);
	return {
		policies: rows.map((p) => ({ ...p, usage: usage[p.id] ?? { services: 0, tokens: 0 } })),
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label })),
		modelSuggestions
	};
};

export const actions: Actions = {
	create: async (event) => {
		await requirePermission(event, 'policies:manage');
		const data = await event.request.formData();
		const parsed = parsePolicyForm(data, await knownModelIds());
		if (!parsed.ok) return fail(400, { action: 'create' as const, message: parsed.message });
		if (await policyNameTaken(parsed.name)) {
			return fail(409, { action: 'create' as const, message: POLICY_NAME_TAKEN });
		}

		await createPolicy({ name: parsed.name, ...parsed.fields });
		return {
			action: 'create' as const,
			success: true,
			warning: unknownModelsWarning(parsed.unknownModels)
		};
	},
	update: async (event) => {
		await requirePermission(event, 'policies:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { action: 'update' as const, message: 'Missing id' });
		const parsed = parsePolicyForm(data, await knownModelIds());
		if (!parsed.ok) return fail(400, { action: 'update' as const, message: parsed.message });
		if (await policyNameTaken(parsed.name, id)) {
			return fail(409, { action: 'update' as const, message: POLICY_NAME_TAKEN });
		}

		const row = await updatePolicy(id, { name: parsed.name, ...parsed.fields });
		if (!row) return fail(404, { action: 'update' as const, message: 'Preset not found' });
		return {
			action: 'update' as const,
			success: true,
			warning: unknownModelsWarning(parsed.unknownModels)
		};
	},
	delete: async (event) => {
		await requirePermission(event, 'policies:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id || !(await deletePolicy(id))) {
			return fail(404, { action: 'delete' as const, message: 'Preset not found' });
		}
		return { action: 'delete' as const, success: true };
	}
};
