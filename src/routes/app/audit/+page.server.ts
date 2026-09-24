import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listAuditPage } from '$lib/server/audit-queries';
import { parseAuditFilter } from '$lib/audit-view';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	// The page always starts at the newest row; later pages come from ./entries.
	const filter = { ...parseAuditFilter(event.url.searchParams), cursor: undefined };
	return { filter, ...(await listAuditPage(filter)) };
};
