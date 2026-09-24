import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { listAuditPage } from '$lib/server/audit-queries';
import { parseAuditFilter } from '$lib/audit-view';

// "Load more" on the audit page: the next page after `cursor`, same filters.
export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);
	return json(await listAuditPage(parseAuditFilter(event.url.searchParams)));
};
