import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { orgStats, listAudit } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	const [stats, recent] = await Promise.all([
		orgStats(organizationId),
		listAudit(organizationId, 8)
	]);
	return { stats, recent };
};
