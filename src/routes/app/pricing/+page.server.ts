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
import { priceSyncEnabled, syncDefaultModelPrices } from '$lib/server/price-sync';
import { audit } from '$lib/server/audit';
import { backfillMissingCosts, unpricedSummary } from '$lib/server/cost-backfill';
import { parseOptionalPrice, parsePrice } from '$lib/server/form';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	return {
		prices: await listEffectiveModelPrices(),
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label })),
		priceSync: priceSyncEnabled(),
		unpriced: await unpricedSummary()
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
 * The long card's prompt-token threshold: blank = the 272k default (null),
 * otherwise a positive integer. Returns false when the value is invalid.
 */
function parseLongThreshold(value: FormDataEntryValue | null): number | null | false {
	const s = value
		?.toString()
		.trim()
		.replace(/[_,\s]/g, '');
	if (!s) return null;
	const n = Number(s);
	return Number.isInteger(n) && n >= 1 ? n : false;
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
	const longMinPromptTokens = parseLongThreshold(data.get('longMinPromptTokens'));
	if (longMinPromptTokens === false)
		return { error: 'Long-context threshold must be a positive whole number of tokens' } as const;
	return {
		prices: {
			provider: data.get('provider')?.toString() || null,
			inputPerMtok,
			outputPerMtok,
			cacheReadPerMtok,
			cacheWritePerMtok,
			...long,
			longMinPromptTokens
		}
	};
}

export const actions: Actions = {
	create: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const model = data.get('model')?.toString().trim();
		if (!model) return fail(400, { action: 'create', message: 'Model is required' });
		const parsed = parsePriceForm(data);
		if ('error' in parsed) return fail(400, { action: 'create', message: parsed.error });
		await createOrgModelPrice({ model, ...parsed.prices });
		return { action: 'create', success: true };
	},
	update: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { action: 'update', message: 'Missing id' });
		const parsed = parsePriceForm(data);
		if ('error' in parsed) return fail(400, { action: 'update', message: parsed.error });
		const row = await updateOrgModelPrice(id, parsed.prices);
		if (!row) return fail(404, { action: 'update', message: 'Not found' });
		return { action: 'update', success: true };
	},
	/** Pull the LiteLLM price list now instead of waiting for the daily sync. */
	refresh: async (event) => {
		await requirePermission(event, 'pricing:manage');
		if (!priceSyncEnabled())
			return fail(400, { action: 'refresh', message: 'Price sync is turned off (PRICE_SYNC=off)' });
		const count = await syncDefaultModelPrices();
		await audit({
			action: 'pricing.sync',
			status: count != null ? 'ok' : 'error',
			detail: count != null ? `${count} prices from LiteLLM` : 'LiteLLM price list fetch failed'
		});
		if (count == null)
			return fail(502, {
				action: 'refresh',
				message: 'Could not fetch the LiteLLM price list — current prices were kept'
			});
		return { action: 'refresh', success: true, count };
	},
	/** Cost the requests recorded without a price, now that their model has one. */
	backfill: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const count = await backfillMissingCosts();
		await audit({
			action: 'pricing.backfill',
			status: 'ok',
			detail: `${count} request costs backfilled`
		});
		return { action: 'backfill', success: true, count };
	},
	delete: async (event) => {
		await requirePermission(event, 'pricing:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { action: 'delete', message: 'Missing id' });
		await deleteOrgModelPrice(id);
		return { action: 'delete', success: true };
	}
};
