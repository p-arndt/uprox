import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	orgStats,
	listAudit,
	orgDailyStats,
	orgBudgetStatus,
	instanceBudgetStatus,
	getSettings
} from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [stats, recent, daily, budgets, instanceBudget, settings] = await Promise.all([
		orgStats(),
		listAudit(8),
		orgDailyStats(14),
		orgBudgetStatus(),
		instanceBudgetStatus(),
		getSettings()
	]);
	return {
		stats,
		recent,
		daily,
		budgets,
		instanceBudget,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
