import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	orgUsageByModel,
	orgUsageByProvider,
	orgUsageByService,
	orgUsageByToken,
	orgUsageTotals,
	orgUsageSeries,
	orgBudgetStatus,
	getSettings
} from '$lib/server/data';
import {
	USAGE_RANGES,
	resolveUsageRange,
	resolveSeriesBucket,
	normalizeBucket,
	shiftRangeBack
} from '$lib/usage-range';

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Default top-N for the breakdown tables; surfaced so the page can flag truncation. */
const BREAKDOWN_LIMIT = 50;

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const params = event.url.searchParams;
	const range = resolveUsageRange(params.get('range'), {
		from: params.get('from'),
		to: params.get('to')
	});
	// Resolve the effective bucket once so the current and previous-period series
	// share an identical granularity (and therefore align bucket-for-bucket).
	const bucket = normalizeBucket(params.get('bucket'));
	const unit = resolveSeriesBucket(range, bucket);
	const prevRange = shiftRangeBack(range);

	const [totals, byModel, byProvider, byService, byToken, series, prevSeries, budgets, settings] =
		await Promise.all([
			orgUsageTotals(range),
			orgUsageByModel(range, { limit: BREAKDOWN_LIMIT }),
			orgUsageByProvider(range),
			orgUsageByService(range),
			orgUsageByToken(range, { limit: BREAKDOWN_LIMIT }),
			orgUsageSeries(range, { unit }),
			orgUsageSeries(prevRange, { unit }),
			// budgets always reflect the current UTC day/month window, not the selected range
			orgBudgetStatus(),
			getSettings()
		]);

	return {
		range: range.key,
		ranges: USAGE_RANGES,
		bucket,
		breakdownLimit: BREAKDOWN_LIMIT,
		// the applied custom window echoed back (inclusive end) so the picker pre-fills
		customFrom: range.key === 'custom' ? ymd(range.start) : null,
		customTo:
			range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null,
		totals,
		byModel,
		byProvider,
		byService,
		byToken,
		series,
		// only the points are needed for the overlay; the unit matches `series`
		prevPoints: prevSeries.points,
		budgets,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
