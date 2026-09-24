import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listTokens,
	createToken,
	updateToken,
	revokeToken,
	deleteToken,
	revealToken
} from '$lib/server/tokens-admin';
import { getOrCreateDefaultService, listServices } from '$lib/server/services';
import { listPolicies } from '$lib/server/policies';
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
		recopyDefault: settings.tokensRecopyableDefault
	};
};

export const actions: Actions = {
	create: async (event) => {
		const { userId } = await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		// blank/absent = let createToken drop the token into the Default service
		const serviceId = data.get('serviceId')?.toString() || undefined;
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400, { message: 'Name is required' });

		const scopes = data.getAll('scopes').map((s) => s.toString());
		const allowedModels = splitList(data.get('allowedModels'));
		// blank = inherit the service's policy
		const policyId = data.get('policyId')?.toString() || null;
		const days = Number(data.get('expiresInDays')) || 0;
		const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
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
			return { created: { name, plaintext, recopyable } };
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Failed to create token' });
		}
	},
	reveal: async (event) => {
		await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { message: 'Missing token id' });
		const revealed = await revealToken(id);
		if (!revealed) return fail(400, { message: 'This token cannot be re-copied' });
		return { revealed };
	},
	update: async (event) => {
		await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		const name = data.get('name')?.toString().trim();
		if (!id) return fail(400, { message: 'Missing token id' });
		if (!name) return fail(400, { message: 'Name is required' });

		// absent = the picker wasn't rendered, so keep the service; blank = the
		// Default service didn't exist when the form loaded, so resolve it now
		const rawServiceId = data.get('serviceId');
		const serviceId =
			rawServiceId === null
				? undefined
				: rawServiceId.toString() || (await getOrCreateDefaultService())?.id;
		await updateToken(id, {
			name,
			...(serviceId ? { serviceId } : {}),
			scopes: data.getAll('scopes').map((s) => s.toString()),
			allowedModels: splitList(data.get('allowedModels')),
			policyId: data.get('policyId')?.toString() || null,
			...inlineFromForm(data)
		});
		return { success: true };
	},
	revoke: async (event) => {
		await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await revokeToken(id);
		return { success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteToken(id);
		return { success: true };
	}
};
