import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	listServices,
	createService,
	updateService,
	deleteService,
	listPolicies
} from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	const [services, policies] = await Promise.all([
		listServices(organizationId),
		listPolicies(organizationId)
	]);
	return { services, policies };
};

export const actions: Actions = {
	create: async (event) => {
		const { organizationId } = await requireOrg(event);
		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });
		await createService(organizationId, {
			name,
			type: data.get('type')?.toString() || 'app',
			description: data.get('description')?.toString() || undefined,
			policyId: data.get('policyId')?.toString() || null
		});
		return { success: true };
	},
	update: async (event) => {
		const { organizationId } = await requireOrg(event);
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });
		await updateService(organizationId, id ?? '', {
			name,
			type: data.get('type')?.toString() || 'app',
			description: data.get('description')?.toString() || null,
			policyId: data.get('policyId')?.toString() || null
		});
		return { success: true };
	},
	delete: async (event) => {
		const { organizationId } = await requireOrg(event);
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteService(organizationId, id);
		return { success: true };
	}
};
