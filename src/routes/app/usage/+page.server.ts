import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	orgUsageByModel,
	orgUsageByService,
	orgUsageByToken,
	orgUsageTotals,
	orgBudgetStatus,
	getSettings
} from '$lib/server/data';
import { USAGE_RANGES, resolveUsageRange } from '$lib/usage-range';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const range = resolveUsageRange(event.url.searchParams.get('range'));

	const [totals, byModel, byService, byToken, budgets, settings] = await Promise.all([
		orgUsageTotals(range),
		orgUsageByModel(range),
		orgUsageByService(range),
		orgUsageByToken(range),
		// budgets always reflect the current UTC day/month window, not the selected range
		orgBudgetStatus(),
		getSettings()
	]);

	return {
		range: range.key,
		ranges: USAGE_RANGES,
		totals,
		byModel,
		byService,
		byToken,
		budgets,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
