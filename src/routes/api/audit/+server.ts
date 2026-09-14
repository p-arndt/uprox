import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { listAudit } from '$lib/server/data';
import { apiHandler } from '$lib/server/api/errors';

export const GET: RequestHandler = apiHandler(async (event) => {
	await requireOrgApi(event);
	// ?limit=N, default 100, capped at 500; invalid or 0 falls back to the default
	const limit = Math.min(Number(event.url.searchParams.get('limit')) || 100, 500);
	return json(await listAudit(limit));
});
