import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listAudit } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	return { entries: await listAudit(organizationId, 200) };
};
