import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listTokens,
	listServices,
	listPolicies,
	createToken,
	updateToken,
	revokeToken,
	revealToken,
	getSettings
} from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [tokens, services, policies, settings] = await Promise.all([
		listTokens(),
		listServices(),
		listPolicies(),
		getSettings()
	]);
	// drives the default state of the "allow re-copying" checkbox in the create form
	return { tokens, services, policies, recopyDefault: settings.tokensRecopyableDefault };
};

/** Parse the shared comma-separated "allowed models" field into a clean list. */
function parseModels(raw: FormDataEntryValue | null): string[] {
	return (raw?.toString() ?? '')
		.split(',')
		.map((m) => m.trim())
		.filter(Boolean);
}

export const actions: Actions = {
	create: async (event) => {
		const { userId } = await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const serviceId = data.get('serviceId')?.toString();
		const name = data.get('name')?.toString().trim();
		if (!serviceId) return fail(400, { message: 'Select a service' });
		if (!name) return fail(400, { message: 'Name is required' });

		const scopes = data.getAll('scopes').map((s) => s.toString());
		const allowedModels = parseModels(data.get('allowedModels'));
		// blank = inherit the service's policy
		const policyId = data.get('policyId')?.toString() || null;
		const days = Number(data.get('expiresInDays')) || 0;
		const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
		// checkbox: present only when ticked. When on, the raw token is stored
		// encrypted so it can be revealed/copied again later.
		const recopyable = data.get('recopyable') === 'on' || data.get('recopyable') === 'true';

		try {
			const { plaintext } = await createToken(userId, {
				serviceId,
				name,
				scopes,
				allowedModels,
				policyId,
				expiresAt,
				recopyable
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

		await updateToken(id, {
			name,
			scopes: data.getAll('scopes').map((s) => s.toString()),
			allowedModels: parseModels(data.get('allowedModels')),
			policyId: data.get('policyId')?.toString() || null
		});
		return { success: true };
	},
	revoke: async (event) => {
		await requirePermission(event, 'tokens:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await revokeToken(id);
		return { success: true };
	}
};
