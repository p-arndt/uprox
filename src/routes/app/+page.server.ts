import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { orgStats, listAudit, orgDailyStats, orgBudgetStatus } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	const [stats, recent, daily, budgets] = await Promise.all([
		orgStats(organizationId),
		listAudit(organizationId, 8),
		orgDailyStats(organizationId, 14),
		orgBudgetStatus(organizationId)
	]);
	return { stats, recent, daily, budgets };
};
