import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	listProviderSecrets,
	createProviderSecret,
	updateProviderSecret,
	deleteProviderSecret
} from '$lib/server/data';
import { PROVIDERS, PROVIDER_IDS, type ProviderDef } from '$lib/server/providers';

/** Parse a priority form field to a finite integer, defaulting to 0. */
function parsePriority(raw: FormDataEntryValue | null): number {
	const n = Number.parseInt(raw?.toString() ?? '', 10);
	return Number.isFinite(n) ? n : 0;
}

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

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const secrets = await listProviderSecrets();
	return {
		secrets,
		providers: Object.values(PROVIDERS).map((p) => ({
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
		if (!PROVIDER_IDS.includes(provider)) return fail(400, { message: 'Unknown provider' });
		const def = PROVIDERS[provider];
		const secret = secretFromForm(def, data);
		if (!secret && !def.optionalAuth) return fail(400, { message: 'API key is required' });
		if (def.requiresEndpoint) {
			const err = endpointError(def, baseUrl);
			if (err) return fail(400, { message: err });
		}
		await createProviderSecret(userId, {
			provider,
			secret,
			label: data.get('label')?.toString() || undefined,
			baseUrl,
			priority: parsePriority(data.get('priority'))
		});
		return { success: true };
	},
	// rotate the key of an existing secret in place
	rotate: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString() ?? '';
		const provider = data.get('provider')?.toString() ?? '';
		if (!id) return fail(400, { message: 'Missing provider secret id' });
		const def = PROVIDERS[provider];
		if (!def) return fail(400, { message: 'Unknown provider' });
		const secret = secretFromForm(def, data);
		// optional-auth providers (Ollama) may rotate to a blank credential to drop
		// basic auth entirely; everyone else must supply a key.
		if (!secret && !def.optionalAuth) return fail(400, { message: 'API key is required' });
		await updateProviderSecret(id, { secret });
		return { success: true };
	},
	// edit a secret's label / endpoint / priority (the key is left unchanged)
	editMeta: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString() ?? '';
		const provider = data.get('provider')?.toString() ?? '';
		const label = data.get('label')?.toString().trim() || undefined;
		const baseUrl = data.get('baseUrl')?.toString().trim() || undefined;
		if (!id) return fail(400, { message: 'Missing provider secret id' });
		const def = PROVIDERS[provider];
		if (def?.requiresEndpoint) {
			const err = endpointError(def, baseUrl);
			if (err) return fail(400, { message: err });
		}
		await updateProviderSecret(id, {
			label: label || null,
			baseUrl: baseUrl || null,
			priority: parsePriority(data.get('priority'))
		});
		return { success: true };
	},
	delete: async (event) => {
		await requirePermission(event, 'providers:manage');
		const data = await event.request.formData();
		const id = data.get('id')?.toString();
		if (id) await deleteProviderSecret(id);
		return { success: true };
	}
};
