/**
 * Request body parsing for /api/policies. Only the fields listed here are read;
 * any other key in the body (e.g. `id`, `createdAt`) is ignored.
 */
import type { createPolicy, updatePolicy } from '$lib/server/policies';
import {
	definedOnly,
	optionalNumber,
	optionalString,
	optionalStringArray,
	requireSomeField,
	requiredString,
	type JsonBody
} from '$lib/server/api/fields';

export type PolicyCreateInput = Parameters<typeof createPolicy>[0];
export type PolicyPatch = Parameters<typeof updatePolicy>[1];

/** POST /api/policies. Absent (or null) limits fall back to the column defaults. */
export function parsePolicyCreate(body: JsonBody): PolicyCreateInput {
	return {
		name: requiredString(body, 'name').trim(),
		allowedProviders: optionalStringArray(body, 'allowedProviders') ?? [],
		allowedModels: optionalStringArray(body, 'allowedModels') ?? [],
		preferredProvider: optionalString(body, 'preferredProvider') ?? null,
		rateLimitPerMinute: optionalNumber(body, 'rateLimitPerMinute', { integer: true }) ?? 0,
		dailyBudgetUsd: optionalNumber(body, 'dailyBudgetUsd') ?? 0,
		monthlyBudgetUsd: optionalNumber(body, 'monthlyBudgetUsd') ?? 0,
		// null/absent = inherit the instance default; a number overrides it
		cacheTtlSeconds: optionalNumber(body, 'cacheTtlSeconds', { integer: true }) ?? null
	};
}

/**
 * PATCH /api/policies/[id]. Only accepted fields that are present are updated.
 * Non-nullable columns reject `null`; `preferredProvider` and `cacheTtlSeconds`
 * accept `null` to clear back to "inherit".
 */
export function parsePolicyPatch(body: JsonBody): PolicyPatch {
	const patch = definedOnly<PolicyPatch>({
		name: body.name === undefined ? undefined : requiredString(body, 'name').trim(),
		allowedProviders: optionalStringArray(body, 'allowedProviders', { nullable: false }),
		allowedModels: optionalStringArray(body, 'allowedModels', { nullable: false }),
		preferredProvider: optionalString(body, 'preferredProvider'),
		rateLimitPerMinute: optionalNumber(body, 'rateLimitPerMinute', {
			integer: true,
			nullable: false
		}),
		dailyBudgetUsd: optionalNumber(body, 'dailyBudgetUsd', { nullable: false }),
		monthlyBudgetUsd: optionalNumber(body, 'monthlyBudgetUsd', { nullable: false }),
		cacheTtlSeconds: optionalNumber(body, 'cacheTtlSeconds', { integer: true })
	});
	requireSomeField(patch);
	return patch;
}
