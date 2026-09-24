/**
 * Request body parsing and response shaping for /api/tokens. Only the fields
 * listed here are read; unknown keys are ignored.
 */
import type { createToken, updateToken } from '$lib/server/tokens-admin';
import {
	definedOnly,
	optionalBoolean,
	optionalDate,
	optionalStringArray,
	optionalUuid,
	requireSomeField,
	requiredString,
	type JsonBody
} from '$lib/server/api/fields';
import { checkedModelPatterns, parseInlineConfigBody } from '$lib/server/api/inline-config-body';
import { badRequest } from '$lib/server/api/errors';

export type TokenCreateInput = Parameters<typeof createToken>[1];
export type TokenPatch = Parameters<typeof updateToken>[1];

/** POST /api/tokens. Omitting `serviceId` puts the token in the Default service. */
export function parseTokenCreate(body: JsonBody): TokenCreateInput {
	return {
		...parseInlineConfigBody(body),
		serviceId: optionalUuid(body, 'serviceId') ?? undefined,
		name: requiredString(body, 'name').trim(),
		scopes: optionalStringArray(body, 'scopes') ?? [],
		allowedModels: checkedModelPatterns(optionalStringArray(body, 'allowedModels')) ?? [],
		policyId: optionalUuid(body, 'policyId') ?? null,
		expiresAt: optionalDate(body, 'expiresAt') ?? null
	};
}

/**
 * PATCH /api/tokens/[id]. `policyId: null` and inline `null`s revert to inheriting.
 * `expiresAt: null` removes the expiry; a date must be in the future.
 * `recopyable` only accepts `false`: the plaintext of a hash-only token is not
 * kept anywhere, so re-copying can't be switched back on.
 */
export function parseTokenPatch(body: JsonBody, now = Date.now()): TokenPatch {
	const expiresAt = optionalDate(body, 'expiresAt');
	if (expiresAt && expiresAt.getTime() <= now) {
		throw badRequest('expiresAt must be in the future', 'expiresAt');
	}
	const recopyable = optionalBoolean(body, 'recopyable', { nullable: false });
	if (recopyable === true) {
		throw badRequest(
			"recopyable can only be set to false: a token's secret cannot be stored after creation",
			'recopyable'
		);
	}
	const patch = definedOnly<TokenPatch>({
		...parseInlineConfigBody(body),
		name: body.name === undefined ? undefined : requiredString(body, 'name').trim(),
		scopes: optionalStringArray(body, 'scopes', { nullable: false }),
		allowedModels: checkedModelPatterns(
			optionalStringArray(body, 'allowedModels', { nullable: false })
		),
		policyId: optionalUuid(body, 'policyId'),
		expiresAt,
		recopyable
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
