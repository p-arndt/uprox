import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import {
	getService,
	listPolicies,
	orgUsageByModel,
	orgUsageByToken,
	orgUsageTotals
} from '$lib/server/data';
import { USAGE_RANGES, resolveUsageRange } from '$lib/usage-range';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const service = await getService(event.params.id);
	if (!service) error(404, 'Service not found');

	const range = resolveUsageRange(event.url.searchParams.get('range'));
	const serviceId = service.id;

	const [totals, byModel, byToken, policies] = await Promise.all([
		orgUsageTotals(range, { serviceId }),
		orgUsageByModel(range, { serviceId }),
		orgUsageByToken(range, { serviceId }),
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
		totals,
		byModel,
		byToken
	};
};
