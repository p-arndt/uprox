/** Upstream provider credentials, read from the encrypted provider secrets. */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { providerSecret } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { selectProviderSecret } from '$lib/server/providers';

export interface ProviderCreds {
	apiKey: string;
	/** endpoint override (Azure), null when the static baseUrl applies */
	baseUrl: string | null;
}

/**
 * Load the credentials to use for a provider. A provider may hold several
 * secrets (e.g. multiple Azure OpenAI resources); `preferSecretId` is the
 * calling service's pinned secret, honoured when it belongs to this provider,
 * otherwise the provider's highest-priority secret is used. See
 * selectProviderSecret.
 */
export async function loadProviderCreds(
	provider: string,
	preferSecretId?: string | null
): Promise<ProviderCreds | null> {
	const rows = await db.select().from(providerSecret).where(eq(providerSecret.provider, provider));
	const picked = selectProviderSecret(rows, provider, preferSecretId);
	if (!picked) return null;
	return { apiKey: decrypt(picked.encryptedSecret), baseUrl: picked.baseUrl };
}

/** Distinct provider ids the instance has at least one secret configured for. */
export async function loadConfiguredProviders(): Promise<string[]> {
	const rows = await db.selectDistinct({ provider: providerSecret.provider }).from(providerSecret);
	return rows.map((r) => r.provider);
}
