import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import { getToken, revealToken } from '$lib/server/tokens-admin';
import { loadUsageAnalysis } from '$lib/server/usage-analysis';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '$lib/server/db';
import { machineToken, policy, service } from '$lib/server/db/schema';
import { explainEffectiveConfig } from '$lib/server/effective-config';
import { getSettings } from '$lib/server/settings';
import { PROVIDERS } from '$lib/server/providers';
import { listServices } from '$lib/server/services';
import { listPolicies } from '$lib/server/policies';
import { inlineLimitsFromRow } from '$lib/features/policies/inline-limits';
import { deleteTokenAction, revokeTokenAction, updateTokenAction } from '$lib/server/token-actions';

/**
 * The token's layers of the config cascade (same joins as resolveToken), so the
 * page can show what actually applies and where each value comes from.
 */
async function loadEffectiveSettings(tokenId: string) {
	const tokenPolicy = alias(policy, 'token_policy');
	const [row] = await db
		.select({
			token: machineToken,
			service: service,
			servicePolicy: policy,
			tokenPolicy: tokenPolicy
		})
		.from(machineToken)
		.innerJoin(service, eq(service.id, machineToken.serviceId))
		.leftJoin(policy, eq(policy.id, service.policyId))
		.leftJoin(tokenPolicy, eq(tokenPolicy.id, machineToken.policyId))
		.where(eq(machineToken.id, tokenId))
		.limit(1);
	if (!row) return null;
	const instance = await getSettings();
	return {
		// the edit dialog prefills from these; the secret columns stay server-side
		inlineLimits: inlineLimitsFromRow(row.token),
		servicePresetName: row.servicePolicy?.name ?? null,
		config: explainEffectiveConfig({
			token: row.token,
			tokenPolicy: row.tokenPolicy,
			service: row.service,
			servicePolicy: row.servicePolicy,
			defaults: {
				cacheTtlSeconds: instance.cacheTtlSeconds,
				dailyBudgetUsd: instance.dailyBudgetUsd ?? 0,
				monthlyBudgetUsd: instance.monthlyBudgetUsd ?? 0
			}
		})
	};
}

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const token = await getToken(event.params.id);
	if (!token) error(404, 'Token not found');
	const [effective, services, policies] = await Promise.all([
		loadEffectiveSettings(token.id),
		listServices(),
		listPolicies()
	]);
	if (!effective) error(404, 'Token not found');

	// Same cost-analysis workbench the org page renders, scoped to this token.
	// `service` and `token` are dropped: a token belongs to exactly one service
	// and is itself the scope, so both would collapse to a single row.
	const analysis = await loadUsageAnalysis(event, {
		tokenId: token.id,
		dimensions: ['model', 'provider', 'status', 'line'],
		donutDims: ['model', 'provider', 'status']
	});

	return {
		token: {
			id: token.id,
			name: token.name,
			display: token.display,
			scopes: token.scopes,
			serviceId: token.serviceId,
			serviceName: token.serviceName,
			policyId: token.policyId,
			policyName: token.policyName,
			servicePresetName: effective.servicePresetName,
			recopyable: token.recopyable,
			createdAt: token.createdAt,
			lastUsedAt: token.lastUsedAt,
			expiresAt: token.expiresAt,
			revokedAt: token.revokedAt
		},
		inlineLimits: effective.inlineLimits,
		effectiveConfig: effective.config,
		services,
		policies,
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label })),
		providerLabels: Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, p.label])),
		crumb: token.name,
		...analysis
	};
};

export const actions: Actions = {
	reveal: async (event) => {
		await requirePermission(event, 'tokens:manage');
		const revealed = await revealToken(event.params.id);
		if (!revealed) return fail(400, { message: 'This token cannot be re-copied' });
		return { revealed };
	},
	update: (event) => updateTokenAction(event, event.params.id),
	revoke: (event) => revokeTokenAction(event, event.params.id),
	delete: async (event) => {
		await deleteTokenAction(event, event.params.id);
		redirect(303, '/app/tokens');
	}
};
