import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { orgBudgetStatus, instanceBudgetStatus, getSettings } from '$lib/server/data';
import { loadUsageAnalysis } from '$lib/server/usage-analysis';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);

	const [analysis, budgets, instanceBudget, settings] = await Promise.all([
		// org-wide: every dimension is available, and the three donuts show the
		// compositions an operator reaches for first
		loadUsageAnalysis(event, { donutDims: ['service', 'model', 'provider'] }),
		// budgets always reflect the current UTC day/month window, not the selected
		// range, and are deliberately NOT filtered: a ceiling applies to all of a
		// service's traffic, so showing a filtered figure against it would mislead.
		orgBudgetStatus(),
		instanceBudgetStatus(),
		getSettings()
	]);

	return {
		...analysis,
		budgets,
		instanceBudget,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
