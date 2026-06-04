import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	getService,
	listPolicies,
	orgUsageByModel,
	orgUsageByToken,
	orgUsageTotals,
	orgUsageSeries
} from '$lib/server/data';
import { USAGE_RANGES, resolveUsageRange } from '$lib/usage-range';

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

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

	const [totals, byModel, byToken, series, policies] = await Promise.all([
		orgUsageTotals(range, { serviceId }),
		orgUsageByModel(range, { serviceId }),
		orgUsageByToken(range, { serviceId }),
		orgUsageSeries(range, { serviceId }),
		listPolicies()
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
		customFrom: range.key === 'custom' ? ymd(range.start) : null,
		customTo:
			range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null,
		totals,
		byModel,
		byToken,
		series
	};
};
