import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listServices,
	createService,
	updateService,
	deleteService,
	listPolicies
} from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [services, policies] = await Promise.all([listServices(), listPolicies()]);
	return { services, policies };
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
			policyId: data.get('policyId')?.toString() || null
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
			policyId: data.get('policyId')?.toString() || null
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
