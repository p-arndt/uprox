import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	orgUsageByModel,
	orgUsageByService,
	orgUsageByToken,
	orgBudgetStatus,
	getSettings
} from '$lib/server/data';

/** Selectable rolling windows for the breakdowns, in days. */
const RANGES = [7, 30, 90];

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const requested = Number(event.url.searchParams.get('days'));
	const days = RANGES.includes(requested) ? requested : 30;

	const [byModel, byService, byToken, budgets, settings] = await Promise.all([
		orgUsageByModel(days),
		orgUsageByService(days),
		orgUsageByToken(days),
		// budgets always reflect the current UTC day/month window, not `days`
		orgBudgetStatus(),
		getSettings()
	]);

	return {
		days,
		ranges: RANGES,
		byModel,
		byService,
		byToken,
		budgets,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
