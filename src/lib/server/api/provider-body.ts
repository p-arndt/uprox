/**
 * Request body parsing for /api/providers. Only the fields listed here are
 * read; unknown keys are ignored.
 */
import type { createProviderSecret } from '$lib/server/provider-secrets';
import { PROVIDER_IDS, PROVIDERS } from '$lib/server/providers';
import { badRequest } from '$lib/server/api/errors';
import {
	optionalNumber,
	optionalString,
	requiredString,
	type JsonBody
} from '$lib/server/api/fields';

export type ProviderCreateInput = Parameters<typeof createProviderSecret>[1];

/** POST /api/providers. `baseUrl` is required for providers with a per-deployment endpoint. */
export function parseProviderCreate(body: JsonBody): ProviderCreateInput {
	const provider = requiredString(body, 'provider');
	if (!PROVIDER_IDS.includes(provider)) {
		throw badRequest(`unknown provider "${provider}"`, 'provider');
	}
	const secret = requiredString(body, 'secret');
	const baseUrl = optionalString(body, 'baseUrl')?.trim() || undefined;
	if (PROVIDERS[provider].requiresEndpoint && !baseUrl) {
		throw badRequest(`${PROVIDERS[provider].label} requires a baseUrl endpoint`, 'baseUrl');
	}
	return {
		provider,
		secret,
		label: optionalString(body, 'label') ?? undefined,
		baseUrl,
		priority: optionalNumber(body, 'priority', { integer: true, min: null }) ?? undefined
	};
}
