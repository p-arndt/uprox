import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { listAudit } from '$lib/server/data';

export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);
	const limit = Math.min(Number(event.url.searchParams.get('limit')) || 100, 500);
	return json(await listAudit(limit));
};
