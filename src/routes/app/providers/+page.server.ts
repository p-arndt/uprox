import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listProviderSecrets,
	createProviderSecret,
	updateProviderSecret,
	deleteProviderSecret,
	getProviderSecretCredential
} from '$lib/server/provider-secrets';
import { testProviderConnection } from '$lib/server/provider-connection';
import { setupProgress } from '$lib/server/setup-progress';
import { PROVIDERS, getProvider, type ProviderDef } from '$lib/server/providers';
import { parsePriority } from '$lib/server/form';

/**
 * Validate a per-org endpoint URL, returning an error message or null. Endpoints
 * must be https, except Ollama which commonly runs over plain http on a private
 * network, so it accepts http too.
 */
function endpointError(def: ProviderDef, baseUrl: string | undefined): string | null {
	if (!baseUrl) return `${def.label} requires an endpoint URL`;
	const pattern = def.id === 'ollama' ? /^https?:\/\//i : /^https:\/\//i;
	if (!pattern.test(baseUrl)) {
		return def.id === 'ollama'
			? 'Endpoint must be an http:// or https:// URL'
			: 'Endpoint must be an https:// URL';
	}
	return null;
}

/**
 * The secret to store for a provider. Basic-auth providers (Ollama) take a
 * username/password pair, joined as "username:password"; everything else takes
 * a single key. Returns an empty string when no credential was supplied.
 */
function secretFromForm(def: ProviderDef, data: FormData): string {
	if (def.authScheme === 'basic') {
		const username = data.get('username')?.toString().trim() ?? '';
		const password = data.get('password')?.toString() ?? '';
		return username || password ? `${username}:${password}` : '';
	}
	return data.get('secret')?.toString().trim() ?? '';
}

/**
 * Probe a credential before saving it, unless the operator chose "Save anyway"
 * (`skipTest`). Returns the fail() to send back when the probe failed, else
 * whether the key was actually tested (skipped providers save untested).
 */
async function checkBeforeSave(
	action: string,
	def: ProviderDef,
	secret: string,
	endpoint: string | null,
	data: FormData
) {
	if (data.get('skipTest')) return { tested: false } as const;
	const result = await testProviderConnection(def, secret, endpoint);
	if (result.status === 'failed') {
		return {
			failure: fail(422, { action, message: result.message, connectionFailed: true as const })
		};
	}
	return { tested: result.status === 'ok' } as const;
}

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [secrets, progress] = await Promise.all([listProviderSecrets(), setupProgress()]);
	return {
		secrets,
		// drives the "next: create a token" hint once the first key is in
		activeTokens: progress.activeTokens,
		providers: Object.values<ProviderDef>(PROVIDERS).map((p) => ({
			id: p.id,
			label: p.label,
			baseUrl: p.baseUrl,
			// providers whose endpoint is per-org (Azure, Ollama) need an endpoint field
			requiresEndpoint: p.requiresEndpoint ?? false,
			// how the credential is entered: 'basic' shows username/password (Ollama)
			authScheme: p.authScheme ?? 'bearer',
			// when true the credential is optional and may be left blank (Ollama)
			optionalAuth: p.optionalAuth ?? false
		}))
	};
};

export const actions: Actions = {
	// add a new secret for a provider (a provider may hold several, e.g. one per
	// Azure OpenAI resource)
	create: async (event) => {
		const { userId } = await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const provider = data.get('provider')?.toString() ?? '';
		const baseUrl = data.get('baseUrl')?.toString().trim() || undefined;
		const def = getProvider(provider);
		if (!def) return fail(400, { action: 'create', message: 'Unknown provider' });
		const secret = secretFromForm(def, data);
		if (!secret && !def.optionalAuth)
			return fail(400, { action: 'create', message: 'API key is required' });
		if (def.requiresEndpoint) {
			const err = endpointError(def, baseUrl);
			if (err) return fail(400, { action: 'create', message: err });
		}
		const check = await checkBeforeSave('create', def, secret, baseUrl ?? null, data);
		if ('failure' in check) return check.failure;
		await createProviderSecret(userId, {
			provider,
			secret,
			label: data.get('label')?.toString() || undefined,
			baseUrl,
			priority: parsePriority(data.get('priority'))
		});
		return { action: 'create', success: true, tested: check.tested };
	},
	// rotate the key of an existing secret in place
	rotate: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString() ?? '';
		if (!id) return fail(400, { action: 'rotate', message: 'Missing provider secret id' });
		// the endpoint the new key must work against lives on the stored secret
		const stored = await getProviderSecretCredential(id);
		if (!stored) return fail(404, { action: 'rotate', message: 'Provider key not found' });
		const def = getProvider(stored.provider);
		if (!def) return fail(400, { action: 'rotate', message: 'Unknown provider' });
		const secret = secretFromForm(def, data);
		// optional-auth providers (Ollama) may rotate to a blank credential to drop
		// basic auth entirely; everyone else must supply a key.
		if (!secret && !def.optionalAuth)
			return fail(400, { action: 'rotate', message: 'API key is required' });
		const check = await checkBeforeSave('rotate', def, secret, stored.baseUrl, data);
		if ('failure' in check) return check.failure;
		await updateProviderSecret(id, { secret });
		return { action: 'rotate', success: true, tested: check.tested };
	},
	// edit a secret's label / endpoint / priority (the key is left unchanged)
	editMeta: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString() ?? '';
		const provider = data.get('provider')?.toString() ?? '';
		const label = data.get('label')?.toString().trim() || undefined;
		const baseUrl = data.get('baseUrl')?.toString().trim() || undefined;
		if (!id) return fail(400, { action: 'editMeta', message: 'Missing provider secret id' });
		const def = getProvider(provider);
		if (def?.requiresEndpoint) {
			const err = endpointError(def, baseUrl);
			if (err) return fail(400, { action: 'editMeta', message: err });
		}
		await updateProviderSecret(id, {
			label: label || null,
			baseUrl: baseUrl || null,
			priority: parsePriority(data.get('priority'))
		});
		return { action: 'editMeta', success: true };
	},
	// probe a stored key against its upstream without changing anything
	test: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString() ?? '';
		const stored = id ? await getProviderSecretCredential(id) : null;
		if (!stored) return fail(404, { action: 'test', message: 'Provider key not found' });
		const def = getProvider(stored.provider);
		if (!def) return fail(400, { action: 'test', message: 'Unknown provider' });
		const result = await testProviderConnection(def, stored.secret, stored.baseUrl);
		return { action: 'test', id, result };
	},
	delete: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteProviderSecret(id);
		return { action: 'delete', success: true };
	}
};
