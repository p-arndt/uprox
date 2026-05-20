import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { listProviderSecrets, upsertProviderSecret } from '$lib/server/data';
import { PROVIDER_IDS } from '$lib/server/providers';

export const GET: RequestHandler = async (event) => {
	const { organizationId } = await requireOrgApi(event);
	return json(await listProviderSecrets(organizationId));
};

export const POST: RequestHandler = async (event) => {
	const { organizationId, userId } = await requireOrgApi(event);
	const body = await event.request.json();
	if (!body?.provider || !body?.secret) {
		return json({ error: 'provider and secret are required' }, { status: 400 });
	}
	if (!PROVIDER_IDS.includes(body.provider)) {
		return json({ error: `unknown provider "${body.provider}"` }, { status: 400 });
	}
	const row = await upsertProviderSecret(organizationId, userId, {
		provider: body.provider,
		secret: body.secret,
		label: body.label
	});
	return json(row, { status: 201 });
};
