import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	deleteService,
	getService,
	listServiceTokens,
	serviceNameTaken,
	SERVICE_NAME_TAKEN,
	updateService
} from '$lib/server/services';
import { orgBudgetStatus } from '$lib/server/budget-status';
import { getSettings } from '$lib/server/settings';
import { loadUsageAnalysis, streamed } from '$lib/server/usage-analysis';
import { explainEffectiveConfig } from '$lib/server/effective-config';
import { PROVIDERS } from '$lib/server/providers';
import { secretLabel, serviceFormOptions, serviceFromForm } from '../service-form.server';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const service = await getService(event.params.id);
	if (!service) error(404, 'Service not found');

	const serviceId = service.id;
	// per-service spend ceilings (current UTC day/month windows) for the budget
	// gauge, narrowed to this service: 0/1 element, only present when this
	// service's preset sets a ceiling. Streamed after first paint.
	const budget = streamed(
		orgBudgetStatus().then((budgets) => budgets.filter((b) => b.serviceId === serviceId)),
		[],
		'budget'
	);
	// The full cost-analysis workbench, scoped to this service. `service` is
	// dropped as a dimension — it is the scope, so it would be a single row.
	const [analysis, options, settings, tokens] = await Promise.all([
		loadUsageAnalysis(event, {
			serviceId,
			dimensions: ['model', 'provider', 'token', 'status', 'line'],
			donutDims: ['model', 'provider', 'token']
		}),
		serviceFormOptions(),
		getSettings(),
		listServiceTokens(serviceId)
	]);
	const servicePolicy = options.policies.find((p) => p.id === service.policyId) ?? null;
	const effectiveConfig = explainEffectiveConfig({
		service,
		servicePolicy,
		defaults: {
			cacheTtlSeconds: settings.cacheTtlSeconds,
			dailyBudgetUsd: settings.dailyBudgetUsd ?? 0,
			monthlyBudgetUsd: settings.monthlyBudgetUsd ?? 0
		}
	});

	const secret = service.providerSecretId
		? options.secrets.find((s) => s.id === service.providerSecretId)
		: undefined;

	return {
		crumb: service.name,
		service: {
			id: service.id,
			name: service.name,
			type: service.type,
			description: service.description,
			createdAt: service.createdAt,
			policyId: service.policyId,
			policyName: service.policyId
				? (options.policies.find((p) => p.id === service.policyId)?.name ?? null)
				: null,
			providerSecretId: service.providerSecretId,
			upstreamKeyLabel: secret ? secretLabel(secret) : null,
			allowedProviders: service.allowedProviders,
			allowedModels: service.allowedModels,
			preferredProvider: service.preferredProvider,
			rateLimitPerMinute: service.rateLimitPerMinute,
			dailyBudgetUsd: service.dailyBudgetUsd,
			monthlyBudgetUsd: service.monthlyBudgetUsd,
			cacheTtlSeconds: service.cacheTtlSeconds
		},
		tokens,
		effectiveConfig,
		providerLabels: Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, p.label])),
		policies: options.policies,
		providerSecrets: options.providerSecrets,
		providers: options.providers,
		defaults: options.defaults,
		...analysis,
		budget,
		budgetThreshold: settings.budgetAlertThresholdPct / 100
	};
};

export const actions: Actions = {
	update: async (event) => {
		await requirePermission(event, 'services:manage');
		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });
		if (await serviceNameTaken(name, event.params.id))
			return fail(409, { message: SERVICE_NAME_TAKEN });
		await updateService(event.params.id, { ...serviceFromForm(data), name });
		return { success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'services:manage');
		await deleteService(event.params.id);
		redirect(303, '/app/services');
	}
};
