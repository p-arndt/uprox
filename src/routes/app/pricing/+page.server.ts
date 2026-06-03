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
	await requireOrg(event);
	return {
		prices: await listEffectiveModelPrices(),
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }))
	};
};

function parsePrice(value: FormDataEntryValue | null): number | null {
	const n = Number(value?.toString().trim());
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse an optional price field: `undefined` when left blank (leave it unset and
 * fall back to the input-price multiplier), a number when valid, or `null` when
 * present but not a non-negative number (a validation error).
 */
function parseOptionalPrice(value: FormDataEntryValue | null): number | null | undefined {
	const s = value?.toString().trim();
	if (!s) return undefined;
	const n = Number(s);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

export const actions: Actions = {
	create: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const model = data.get('model')?.toString().trim();
		if (!model) return fail(400, { message: 'Model is required' });
		const inputPerMtok = parsePrice(data.get('inputPerMtok'));
		const outputPerMtok = parsePrice(data.get('outputPerMtok'));
		if (inputPerMtok === null || outputPerMtok === null)
			return fail(400, { message: 'Prices must be non-negative numbers' });
		const cacheReadPerMtok = parseOptionalPrice(data.get('cacheReadPerMtok'));
		const cacheWritePerMtok = parseOptionalPrice(data.get('cacheWritePerMtok'));
		if (cacheReadPerMtok === null || cacheWritePerMtok === null)
			return fail(400, { message: 'Cache prices must be non-negative numbers' });

		await createOrgModelPrice({
			model,
			provider: data.get('provider')?.toString() || null,
			inputPerMtok,
			outputPerMtok,
			cacheReadPerMtok,
			cacheWritePerMtok
		});
		return { success: true };
	},
	update: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { message: 'Missing id' });
		const inputPerMtok = parsePrice(data.get('inputPerMtok'));
		const outputPerMtok = parsePrice(data.get('outputPerMtok'));
		if (inputPerMtok === null || outputPerMtok === null)
			return fail(400, { message: 'Prices must be non-negative numbers' });
		const cacheReadPerMtok = parseOptionalPrice(data.get('cacheReadPerMtok'));
		const cacheWritePerMtok = parseOptionalPrice(data.get('cacheWritePerMtok'));
		if (cacheReadPerMtok === null || cacheWritePerMtok === null)
			return fail(400, { message: 'Cache prices must be non-negative numbers' });

		const row = await updateOrgModelPrice(id, {
			provider: data.get('provider')?.toString() || null,
			inputPerMtok,
			outputPerMtok,
			cacheReadPerMtok,
			cacheWritePerMtok
		});
		if (!row) return fail(404, { message: 'Not found' });
		return { success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteOrgModelPrice(id);
		return { success: true };
	}
};
