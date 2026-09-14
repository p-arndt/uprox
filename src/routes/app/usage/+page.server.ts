import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { orgBudgetStatus, instanceBudgetStatus, getSettings } from '$lib/server/data';
import { loadUsageAnalysis, streamed } from '$lib/server/usage-analysis';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);

	// Budgets always reflect the current UTC day/month window, not the selected
	// range, and are deliberately NOT filtered: a ceiling applies to all of a
	// service's traffic, so showing a filtered figure against it would mislead.
	// Streamed: they're not needed for the first paint. The instance ceiling
	// leads the list, as both the alert and the gauge render it first.
	const budgets = streamed(
		Promise.all([orgBudgetStatus(), instanceBudgetStatus()]).then(([services, instance]) =>
			instance ? [instance, ...services] : services
		),
		[],
		'budgets'
	);

	const [analysis, settings] = await Promise.all([
		// org-wide: every dimension is available, and the three donuts show the
		// compositions an operator reaches for first
		loadUsageAnalysis(event, { donutDims: ['service', 'model', 'provider'] }),
		getSettings()
	]);

	return {
		...analysis,
		budgets,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
