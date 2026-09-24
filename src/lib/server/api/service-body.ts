/**
 * Request body parsing for /api/services. Only the fields listed here are read;
 * unknown keys are ignored.
 */
import type { createService, updateService } from '$lib/server/services';
import {
	definedOnly,
	optionalString,
	optionalStringArray,
	optionalUuid,
	requireSomeField,
	requiredString,
	type JsonBody
} from '$lib/server/api/fields';
import { checkedModelPatterns, parseInlineConfigBody } from '$lib/server/api/inline-config-body';

export type ServiceCreateInput = Parameters<typeof createService>[0];
export type ServicePatch = Parameters<typeof updateService>[1];

/** POST /api/services. */
export function parseServiceCreate(body: JsonBody): ServiceCreateInput {
	return {
		...parseInlineConfigBody(body),
		...definedOnly({
			allowedModels: checkedModelPatterns(optionalStringArray(body, 'allowedModels'))
		}),
		name: requiredString(body, 'name').trim(),
		type: optionalString(body, 'type')?.trim() || undefined,
		description: optionalString(body, 'description') ?? undefined,
		policyId: optionalUuid(body, 'policyId') ?? null,
		providerSecretId: optionalUuid(body, 'providerSecretId') ?? null
	};
}

/** PATCH /api/services/[id]. `null` clears description, policyId, providerSecretId and inline overrides. */
export function parseServicePatch(body: JsonBody): ServicePatch {
	const patch = definedOnly<ServicePatch>({
		...parseInlineConfigBody(body),
		allowedModels: checkedModelPatterns(optionalStringArray(body, 'allowedModels')),
		name: body.name === undefined ? undefined : requiredString(body, 'name').trim(),
		type: body.type === undefined ? undefined : requiredString(body, 'type').trim(),
		description: optionalString(body, 'description'),
		policyId: optionalUuid(body, 'policyId'),
		providerSecretId: optionalUuid(body, 'providerSecretId')
	});
	requireSomeField(patch);
	return patch;
}
