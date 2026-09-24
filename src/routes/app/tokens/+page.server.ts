import { modelPatternsError } from '$lib/model-patterns';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import { listTokens, createToken } from '$lib/server/tokens-admin';
import {
	deleteTokenAction,
	expiryFromForm,
	revealTokenAction,
	revokeTokenAction,
	updateTokenAction
} from '$lib/server/token-actions';
import { listServices } from '$lib/server/services';
import { knownModelIds, listPolicies } from '$lib/server/policies';
import { getSettings } from '$lib/server/settings';
import { inlineFromForm, splitList } from '$lib/server/parse-config';
import { isOn } from '$lib/server/form';
import { PROVIDERS } from '$lib/server/providers';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [tokens, services, policies, settings] = await Promise.all([
		listTokens(),
		listServices(),
		listPolicies(),
		getSettings()
	]);
	// drives the default state of the "allow re-copying" checkbox in the create form
	// the service's preset still applies to tokens without their own, so the row names it
	const presetNames = new Map(policies.map((p) => [p.id, p.name]));
	const servicePresets = new Map(
		services.map((s) => [s.id, s.policyId ? (presetNames.get(s.policyId) ?? null) : null])
	);
	return {
		tokens: tokens.map((t) => ({
			...t,
			servicePolicyName: servicePresets.get(t.serviceId) ?? null
		})),
		services,
		policies,
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label })),
		recopyDefault: settings.tokensRecopyableDefault,
		// the bottom of the cascade, so the token forms can show what blank fields inherit
		modelSuggestions: await knownModelIds(),
		defaults: {
			cacheTtlSeconds: settings.cacheTtlSeconds,
			dailyBudgetUsd: settings.dailyBudgetUsd ?? 0,
			monthlyBudgetUsd: settings.monthlyBudgetUsd ?? 0
		}
	};
};

export const actions: Actions = {
	create: async (event) => {
		const { userId } = await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		// blank/absent = let createToken drop the token into the Default service
		const serviceId = data.get('serviceId')?.toString() || undefined;
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { action: 'create' as const, message: 'Name is required' });

		const scopes = data.getAll('scopes').map((s) => s.toString());
		const allowedModels = splitList(data.get('allowedModels'));
		const modelsError = modelPatternsError(allowedModels);
		if (modelsError) return fail(400, { action: 'create' as const, message: modelsError });
		// blank = no token preset; the service's preset (if any) still applies
		const policyId = data.get('policyId')?.toString() || null;
		const expiresAt = expiryFromForm(data.get('expiresInDays')) ?? null;
		// checkbox: present only when ticked. When on, the raw token is stored
		// encrypted so it can be revealed/copied again later.
		const recopyable = isOn(data.get('recopyable'));

		try {
			const { plaintext } = await createToken(userId, {
				serviceId,
				name,
				scopes,
				allowedModels,
				policyId,
				expiresAt,
				recopyable,
				...inlineFromForm(data)
			});
			// shown immediately; recoverable later only if recopyable was set
			return { action: 'create' as const, created: { name, plaintext, recopyable } };
		} catch (err) {
			return fail(400, {
				action: 'create' as const,
				message: err instanceof Error ? err.message : 'Failed to create token'
			});
		}
	},
	reveal: (event) => revealTokenAction(event),
	update: (event) => updateTokenAction(event),
	revoke: (event) => revokeTokenAction(event),
	delete: (event) => deleteTokenAction(event)
};
