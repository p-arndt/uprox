import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listProviderSecrets, createProviderSecret } from '$lib/server/data';
import { PROVIDER_IDS, PROVIDERS } from '$lib/server/providers';

export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);
	return json(await listProviderSecrets());
};

export const POST: RequestHandler = async (event) => {
	const { userId } = await requirePermission(event, 'providers:manage');
	const body = await event.request.json();
	if (!body?.provider || !body?.secret) {
		return json({ error: 'provider and secret are required' }, { status: 400 });
	}
	if (!PROVIDER_IDS.includes(body.provider)) {
		return json({ error: `unknown provider "${body.provider}"` }, { status: 400 });
	}
	const baseUrl = body.baseUrl?.toString().trim() || undefined;
	if (PROVIDERS[body.provider].requiresEndpoint && !baseUrl) {
		return json(
			{ error: `${PROVIDERS[body.provider].label} requires a baseUrl endpoint` },
			{ status: 400 }
		);
	}
	const row = await createProviderSecret(userId, {
		provider: body.provider,
		secret: body.secret,
		label: body.label,
		baseUrl,
		priority: typeof body.priority === 'number' ? body.priority : undefined
	});
	return json(row, { status: 201 });
};
