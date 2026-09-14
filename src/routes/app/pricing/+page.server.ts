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
import { parseOptionalPrice, parsePrice } from '$lib/server/form';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	return {
		prices: await listEffectiveModelPrices(),
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }))
	};
};

/**
 * Parse the four optional long-context fields. Returns the parsed set, or null
 * if any present value isn't a non-negative number. A blank long input rate
 * leaves the model on a single rate card.
 */
function parseLongTier(data: FormData) {
	const fields = [
		'longInputPerMtok',
		'longOutputPerMtok',
		'longCacheReadPerMtok',
		'longCacheWritePerMtok'
	] as const;
	const out: Partial<Record<(typeof fields)[number], number | null | undefined>> = {};
	for (const f of fields) {
		const v = parseOptionalPrice(data.get(f));
		if (v === null) return null;
		// undefined (blank) is stored as an explicit null so clearing a field in the
		// edit form actually removes the rate rather than silently keeping the old one.
		out[f] = v ?? null;
	}
	return out;
}

/**
 * Parse and validate the rate-card fields shared by create and update. Returns
 * the prices, or a validation message.
 */
function parsePriceForm(data: FormData) {
	const inputPerMtok = parsePrice(data.get('inputPerMtok'));
	const outputPerMtok = parsePrice(data.get('outputPerMtok'));
	if (inputPerMtok === null || outputPerMtok === null)
		return { error: 'Prices must be non-negative numbers' } as const;
	const cacheReadPerMtok = parseOptionalPrice(data.get('cacheReadPerMtok'));
	const cacheWritePerMtok = parseOptionalPrice(data.get('cacheWritePerMtok'));
	if (cacheReadPerMtok === null || cacheWritePerMtok === null)
		return { error: 'Cache prices must be non-negative numbers' } as const;
	const long = parseLongTier(data);
	if (long === null) return { error: 'Long-context prices must be non-negative numbers' } as const;
	return {
		prices: {
			provider: data.get('provider')?.toString() || null,
			inputPerMtok,
			outputPerMtok,
			cacheReadPerMtok,
			cacheWritePerMtok,
			...long
		}
	};
}

export const actions: Actions = {
	create: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const model = data.get('model')?.toString().trim();
		if (!model) return fail(400, { message: 'Model is required' });
		const parsed = parsePriceForm(data);
		if ('error' in parsed) return fail(400, { message: parsed.error });
		await createOrgModelPrice({ model, ...parsed.prices });
		return { success: true };
	},
	update: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { message: 'Missing id' });
		const parsed = parsePriceForm(data);
		if ('error' in parsed) return fail(400, { message: parsed.error });
		const row = await updateOrgModelPrice(id, parsed.prices);
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
