import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	orgUsageByModel,
	orgUsageByService,
	orgUsageByToken,
	orgUsageTotals,
	orgUsageSeries,
	orgBudgetStatus,
	getSettings
} from '$lib/server/data';
import { USAGE_RANGES, resolveUsageRange } from '$lib/usage-range';

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const params = event.url.searchParams;
	const range = resolveUsageRange(params.get('range'), {
		from: params.get('from'),
		to: params.get('to')
	});

	const [totals, byModel, byService, byToken, series, budgets, settings] = await Promise.all([
		orgUsageTotals(range),
		orgUsageByModel(range),
		orgUsageByService(range),
		orgUsageByToken(range),
		orgUsageSeries(range),
		// budgets always reflect the current UTC day/month window, not the selected range
		orgBudgetStatus(),
		getSettings()
	]);

	return {
		range: range.key,
		ranges: USAGE_RANGES,
		// the applied custom window echoed back (inclusive end) so the picker pre-fills
		customFrom: range.key === 'custom' ? ymd(range.start) : null,
		customTo:
			range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null,
		totals,
		byModel,
		byService,
		byToken,
		series,
		budgets,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
