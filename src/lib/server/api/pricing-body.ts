/**
 * Request body parsing for /api/pricing. Only the fields listed here are read;
 * any other key in the body (e.g. `id`, `isDefault`) is ignored.
 */
import type { ModelPriceInput, updateOrgModelPrice } from '$lib/server/pricing';
import {
	definedOnly,
	optionalNumber,
	optionalString,
	requireSomeField,
	requiredNumber,
	requiredString,
	type JsonBody
} from '$lib/server/api/fields';

export type PricingPatch = Parameters<typeof updateOrgModelPrice>[1];

/** Rates that are optional and may be cleared back to NULL (cache and long-context). */
export const NULLABLE_RATES = [
	'cacheReadPerMtok',
	'cacheWritePerMtok',
	'longInputPerMtok',
	'longOutputPerMtok',
	'longCacheReadPerMtok',
	'longCacheWritePerMtok'
] as const;

type NullableRates = Pick<ModelPriceInput, (typeof NULLABLE_RATES)[number]>;

/** The optional rates present in the body: a non-negative number, or null to clear. */
function nullableRates(body: JsonBody): NullableRates {
	const rates: NullableRates = {};
	for (const key of NULLABLE_RATES) {
		const v = optionalNumber(body, key);
		if (v !== undefined) rates[key] = v;
	}
	return rates;
}

/** POST /api/pricing. Creates or replaces the custom price for `model`. */
export function parsePricingCreate(body: JsonBody): ModelPriceInput {
	return {
		model: requiredString(body, 'model'),
		provider: optionalString(body, 'provider') ?? null,
		inputPerMtok: requiredNumber(body, 'inputPerMtok'),
		outputPerMtok: requiredNumber(body, 'outputPerMtok'),
		...nullableRates(body)
	};
}

/**
 * PATCH /api/pricing/[id]. `inputPerMtok`/`outputPerMtok` cannot be cleared;
 * `provider` and the optional rates accept `null` to clear.
 */
export function parsePricingPatch(body: JsonBody): PricingPatch {
	const patch = definedOnly<PricingPatch>({
		provider: optionalString(body, 'provider'),
		inputPerMtok: optionalNumber(body, 'inputPerMtok', { nullable: false }),
		outputPerMtok: optionalNumber(body, 'outputPerMtok', { nullable: false }),
		...nullableRates(body)
	});
	requireSomeField(patch);
	return patch;
}
