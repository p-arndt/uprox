import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { orgUsageByModel, orgUsageByService, orgBudgetStatus } from '$lib/server/data';

/** Selectable rolling windows for the breakdowns, in days. */
const RANGES = [7, 30, 90];

export const load: PageServerLoad = async (event) => {
	const { organizationId } = await requireOrg(event);
	const requested = Number(event.url.searchParams.get('days'));
	const days = RANGES.includes(requested) ? requested : 30;

	const [byModel, byService, budgets] = await Promise.all([
		orgUsageByModel(organizationId, days),
		orgUsageByService(organizationId, days),
		// budgets always reflect the current UTC day/month window, not `days`
		orgBudgetStatus(organizationId)
	]);

	return { days, ranges: RANGES, byModel, byService, budgets };
};
