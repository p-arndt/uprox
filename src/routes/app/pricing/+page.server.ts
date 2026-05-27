import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listEffectiveModelPrices,
	createOrgModelPrice,
	updateOrgModelPrice,
	deleteOrgModelPrice
} from '$lib/server/pricing';
import { PROVIDERS } from '$lib/server/providers';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	return {
		prices: await listEffectiveModelPrices(organizationId),
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }))
	};
};

function parsePrice(value: FormDataEntryValue | null): number | null {
	const n = Number(value?.toString().trim());
	return Number.isFinite(n) && n >= 0 ? n : null;
}

export const actions: Actions = {
	create: async (event) => {
		const { organizationId } = await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const model = data.get('model')?.toString().trim();
		if (!model) return fail(400, { message: 'Model is required' });
		const inputPerMtok = parsePrice(data.get('inputPerMtok'));
		const outputPerMtok = parsePrice(data.get('outputPerMtok'));
		if (inputPerMtok === null || outputPerMtok === null)
			return fail(400, { message: 'Prices must be non-negative numbers' });

		await createOrgModelPrice(organizationId, {
			model,
			provider: data.get('provider')?.toString() || null,
			inputPerMtok,
			outputPerMtok
		});
		return { success: true };
	},
	update: async (event) => {
		const { organizationId } = await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { message: 'Missing id' });
		const inputPerMtok = parsePrice(data.get('inputPerMtok'));
		const outputPerMtok = parsePrice(data.get('outputPerMtok'));
		if (inputPerMtok === null || outputPerMtok === null)
			return fail(400, { message: 'Prices must be non-negative numbers' });

		const row = await updateOrgModelPrice(organizationId, id, {
			provider: data.get('provider')?.toString() || null,
			inputPerMtok,
			outputPerMtok
		});
		if (!row) return fail(404, { message: 'Not found' });
		return { success: true };
	},
	delete: async (event) => {
		const { organizationId } = await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteOrgModelPrice(organizationId, id);
		return { success: true };
	}
};
