import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { providerSecret } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { PROVIDERS, resolveBaseUrl, authHeaders } from '$lib/server/providers';
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
 * instance has credentials for, filtered by the token's policy.
 */
export const GET: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;
	const { token, ip } = auth.auth;

	const secrets = await db.select().from(providerSecret);

	const models: ModelEntry[] = [];
	const seen = new Set<string>();
	for (const secret of secrets) {
		const def = PROVIDERS[secret.provider];
		if (!def) continue;
		// provider-level gate: skip a provider the token can't reach at all (empty
		// model = provider/scope check only, model allowlists are evaluated per id
		// below). Saves the upstream call for a fully-disallowed provider.
		if (!evaluatePolicy(token, { provider: def.id, model: '', scope: 'models' }).allow) continue;
		const base = resolveBaseUrl(def, secret.baseUrl);
		if (!base) continue;
		try {
			const res = await fetch(`${base}/models`, {
				headers: authHeaders(def, decrypt(secret.encryptedSecret))
			});
			if (!res.ok) continue;
			const data = (await res.json()) as { data?: { id: string }[] };
			for (const m of data.data ?? []) {
				// Model ids are callable as-is (no provider alias). OpenAI and Azure
				// share the namespace, so dedupe ids when both are configured.
				if (seen.has(m.id)) continue;
				// hide models this token's policy / per-token allowlist forbids, so the
				// catalog reflects exactly what the token can actually call.
				if (!evaluatePolicy(token, { provider: def.id, model: m.id, scope: 'models' }).allow)
					continue;
				seen.add(m.id);
				models.push({ id: m.id, object: 'model', owned_by: def.id });
			}
		} catch {
			// skip providers that fail to list
		}
	}

	await audit({
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
