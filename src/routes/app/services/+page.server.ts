import { modelPatternsError } from '$lib/model-patterns';
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
		if (!name) return fail(400, { action: 'create', message: 'Name is required' });
		if (await serviceNameTaken(name))
			return fail(409, { action: 'create', message: SERVICE_NAME_TAKEN });
		const fields = serviceFromForm(data);
		const modelsError = modelPatternsError(fields.allowedModels ?? []);
		if (modelsError) return fail(400, { action: 'create', message: modelsError });
		await createService({ ...fields, name, description: fields.description ?? undefined });
		return { action: 'create', success: true };
	},
	update: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { action: 'update', message: 'Missing service id' });
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { action: 'update', message: 'Name is required' });
		if (await serviceNameTaken(name, id))
			return fail(409, { action: 'update', message: SERVICE_NAME_TAKEN });
		const fields = serviceFromForm(data);
		const modelsError = modelPatternsError(fields.allowedModels ?? []);
		if (modelsError) return fail(400, { action: 'update', message: modelsError });
		await updateService(id, { ...fields, name });
		return { action: 'update', success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { action: 'delete', message: 'Missing service id' });
		await deleteService(id);
		return { action: 'delete', success: true };
	}
};
