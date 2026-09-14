/**
 * Request body parsing and response shaping for /api/tokens. Only the fields
 * listed here are read; unknown keys are ignored.
 */
import type { createToken, updateToken } from '$lib/server/tokens-admin';
import {
	definedOnly,
	optionalDate,
	optionalStringArray,
	optionalUuid,
	requireSomeField,
	requiredString,
	type JsonBody
} from '$lib/server/api/fields';
import { parseInlineConfigBody } from '$lib/server/api/inline-config-body';

export type TokenCreateInput = Parameters<typeof createToken>[1];
export type TokenPatch = Parameters<typeof updateToken>[1];

/** POST /api/tokens. Omitting `serviceId` puts the token in the Default service. */
export function parseTokenCreate(body: JsonBody): TokenCreateInput {
	return {
		...parseInlineConfigBody(body),
		serviceId: optionalUuid(body, 'serviceId') ?? undefined,
		name: requiredString(body, 'name').trim(),
		scopes: optionalStringArray(body, 'scopes') ?? [],
		allowedModels: optionalStringArray(body, 'allowedModels') ?? [],
		policyId: optionalUuid(body, 'policyId') ?? null,
		expiresAt: optionalDate(body, 'expiresAt') ?? null
	};
}

/** PATCH /api/tokens/[id]. `policyId: null` and inline `null`s revert to inheriting. */
export function parseTokenPatch(body: JsonBody): TokenPatch {
	const patch = definedOnly<TokenPatch>({
		...parseInlineConfigBody(body),
		name: body.name === undefined ? undefined : requiredString(body, 'name').trim(),
		scopes: optionalStringArray(body, 'scopes', { nullable: false }),
		allowedModels: optionalStringArray(body, 'allowedModels', { nullable: false }),
		policyId: optionalUuid(body, 'policyId')
	});
	requireSomeField(patch);
	return patch;
}

/**
 * A machine token row as returned by the API: the secret-derived columns
 * (`hashedToken`, `encryptedToken`) are never sent; `recopyable` says whether
 * the raw token can be revealed again.
 */
export function tokenResponse<T extends { hashedToken: string; encryptedToken: string | null }>(
	row: T
): Omit<T, 'hashedToken' | 'encryptedToken'> & { recopyable: boolean } {
	const out: Partial<T> = { ...row };
	delete out.hashedToken;
	delete out.encryptedToken;
	return {
		...(out as Omit<T, 'hashedToken' | 'encryptedToken'>),
		recopyable: row.encryptedToken !== null
	};
}
