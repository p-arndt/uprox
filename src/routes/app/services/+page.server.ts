import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listServices,
	createService,
	updateService,
	deleteService,
	countActiveTokensByService,
	serviceNameTaken,
	SERVICE_NAME_TAKEN
} from '$lib/server/services';
import { serviceFormOptions, serviceFromForm } from './service-form.server';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [rows, activeTokens, options] = await Promise.all([
		listServices(),
		countActiveTokensByService(),
		serviceFormOptions()
	]);
	return {
		services: rows.map((s) => ({ ...s, activeTokenCount: activeTokens[s.id] ?? 0 })),
		policies: options.policies,
		providerSecrets: options.providerSecrets,
		providers: options.providers,
		defaults: options.defaults
	};
};

export const actions: Actions = {
	create: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });
		if (await serviceNameTaken(name)) return fail(409, { message: SERVICE_NAME_TAKEN });
		const fields = serviceFromForm(data);
		await createService({ ...fields, name, description: fields.description ?? undefined });
		return { success: true };
	},
	update: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });
		if (await serviceNameTaken(name, id)) return fail(409, { message: SERVICE_NAME_TAKEN });
		await updateService(id ?? '', { ...serviceFromForm(data), name });
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
