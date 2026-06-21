import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	getService,
	listPolicies,
	orgUsageByModel,
	orgUsageByProvider,
	orgUsageByToken,
	orgUsageTotals,
	orgUsageSeries,
	orgBudgetStatus
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
	const service = await getService(event.params.id);
	if (!service) error(404, 'Service not found');

	const params = event.url.searchParams;
	const range = resolveUsageRange(params.get('range'), {
		from: params.get('from'),
		to: params.get('to')
	});
	const serviceId = service.id;
	const bucket = normalizeBucket(params.get('bucket'));
	const unit = resolveSeriesBucket(range, bucket);
	const prevRange = shiftRangeBack(range);

	const [totals, prevTotals, byModel, byProvider, byToken, series, prevSeries, policies, budgets] =
		await Promise.all([
			orgUsageTotals(range, { serviceId }),
			// previous equal-length window — powers the headline deltas
			orgUsageTotals(prevRange, { serviceId }),
			orgUsageByModel(range, { serviceId, limit: BREAKDOWN_LIMIT }),
			orgUsageByProvider(range, { serviceId }),
			orgUsageByToken(range, { serviceId, limit: BREAKDOWN_LIMIT }),
			orgUsageSeries(range, { serviceId, unit }),
			orgUsageSeries(prevRange, { serviceId, unit }),
			listPolicies(),
			// per-service spend ceilings (current UTC day/month windows) for the budget
			// gauge; narrowed to this service below
			orgBudgetStatus()
		]);

	return {
		service: {
			id: service.id,
			name: service.name,
			type: service.type,
			description: service.description,
			createdAt: service.createdAt,
			policyName: service.policyId
				? (policies.find((p) => p.id === service.policyId)?.name ?? null)
				: null
		},
		range: range.key,
		ranges: USAGE_RANGES,
		bucket,
		breakdownLimit: BREAKDOWN_LIMIT,
		customFrom: range.key === 'custom' ? ymd(range.start) : null,
		customTo:
			range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null,
		totals,
		prevTotals,
		byModel,
		byProvider,
		byToken,
		series,
		prevPoints: prevSeries.points,
		// 0/1-element: only present when this service's policy sets a ceiling
		budget: budgets.filter((b) => b.serviceId === serviceId)
	};
};
