import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getService, listPolicies, orgBudgetStatus, getSettings } from '$lib/server/data';
import { loadUsageAnalysis } from '$lib/server/usage-analysis';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const service = await getService(event.params.id);
	if (!service) error(404, 'Service not found');

	const serviceId = service.id;
	// The full cost-analysis workbench, scoped to this service. `service` is
	// dropped as a dimension — it is the scope, so it would be a single row.
	const [analysis, policies, budgets, settings] = await Promise.all([
		loadUsageAnalysis(event, {
			serviceId,
			dimensions: ['model', 'provider', 'token', 'status'],
			donutDims: ['model', 'provider', 'token']
		}),
		listPolicies(),
		// per-service spend ceilings (current UTC day/month windows) for the budget
		// gauge; narrowed to this service below
		orgBudgetStatus(),
		getSettings()
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
		...analysis,
		// 0/1-element: only present when this service's policy sets a ceiling
		budget: budgets.filter((b) => b.serviceId === serviceId),
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};
