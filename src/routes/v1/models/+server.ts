import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { providerSecret } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { PROVIDERS } from '$lib/server/providers';
import { authenticateGateway } from '$lib/server/gateway';
import { evaluatePolicy } from '$lib/server/policy';
import { audit } from '$lib/server/audit';

interface ModelEntry {
	id: string;
	object: 'model';
	owned_by: string;
}

/**
 * OpenAI-compatible model listing. Aggregates models from every provider this
 * organization has credentials for, filtered by the token's policy.
 */
export const GET: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;
	const { token, ip } = auth.auth;

	const secrets = await db
		.select()
		.from(providerSecret)
		.where(eq(providerSecret.organizationId, token.organizationId));

	const models: ModelEntry[] = [];
	for (const secret of secrets) {
		const def = PROVIDERS[secret.provider];
		if (!def) continue;
		// only list providers this token's policy allows
		if (!evaluatePolicy(token, { provider: def.id, model: '', scope: 'models' }).allow) continue;
		try {
			const res = await fetch(`${def.baseUrl}/models`, {
				headers: { authorization: `Bearer ${decrypt(secret.encryptedSecret)}` }
			});
			if (!res.ok) continue;
			const data = (await res.json()) as { data?: { id: string }[] };
			for (const m of data.data ?? []) {
				models.push({ id: m.id, object: 'model', owned_by: def.id });
			}
		} catch {
			// skip providers that fail to list
		}
	}

	await audit({
		organizationId: token.organizationId,
		action: 'gateway.models',
		status: 'ok',
		serviceId: token.serviceId,
		tokenId: token.tokenId,
		statusCode: 200,
		ip,
		detail: `${models.length} models`
	});

	return json({ object: 'list', data: models });
};
