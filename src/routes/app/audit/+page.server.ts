import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listAudit } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	return { entries: await listAudit(200) };
};
