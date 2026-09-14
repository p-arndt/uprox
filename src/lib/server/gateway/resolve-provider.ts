/** Model-based provider routing for the OpenAI-compatible surface. */
import { providerForModel, resolveProvider, type ProviderDef } from '$lib/server/providers';
import { loadConfiguredProviders } from './credentials';
import { reject, type RequestContext } from './context';

/**
 * Route by model, choosing among the providers this instance has configured.
 * OpenAI and Azure share the model namespace; an explicit `preferProvider` (set
 * by Azure-style URL routes to signal URL-level intent) wins, otherwise the
 * policy's preferredProvider breaks the tie. See resolveProvider.
 */
export async function resolveRoutedProvider(
	ctx: RequestContext,
	preferProvider: string | undefined
): Promise<ProviderDef | Response> {
	const configuredProviders = await loadConfiguredProviders();
	const provider = resolveProvider(
		ctx.model,
		configuredProviders,
		preferProvider ?? ctx.token.effective.preferredProvider
	);
	if (provider) return provider;

	// Distinguish "we don't recognize this model" from "we recognize it but the
	// instance hasn't configured the provider that would serve it".
	const known = providerForModel(ctx.model);
	if (known) {
		return reject(
			ctx,
			{ provider: known.id, statusCode: 502, detail: `no ${known.id} secret configured` },
			ctx.envelope.error(
				502,
				`No ${known.label} credentials configured for this instance`,
				'upstream_misconfigured'
			)
		);
	}
	return reject(
		ctx,
		{ statusCode: 400, detail: `unknown model "${ctx.model}"` },
		ctx.envelope.error(400, `Unknown or unsupported model: ${ctx.model}`, 'model_not_found')
	);
}
