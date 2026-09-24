/** Load data and form parsing shared by the service list and detail pages. */
import { listPolicies } from '$lib/server/policies';
import { listProviderSecrets } from '$lib/server/provider-secrets';
import { inlineFromForm } from '$lib/server/parse-config';
import { PROVIDERS } from '$lib/server/providers';

type Secret = Awaited<ReturnType<typeof listProviderSecrets>>[number];

/** "Azure OpenAI — eu-west" or, for an unlabelled key, its masked hint. */
export function secretLabel(s: Pick<Secret, 'provider' | 'label' | 'hint'>) {
	return `${PROVIDERS[s.provider]?.label ?? s.provider} — ${s.label || `••••${s.hint}`}`;
}

/**
 * Everything service-form.svelte needs besides the values themselves, plus the
 * raw secret list so a page can name a pinned key server-side (the picker omits
 * single-key providers, so it can't be used for that lookup).
 */
export async function serviceFormOptions() {
	const [policies, secrets] = await Promise.all([listPolicies(), listProviderSecrets()]);
	// Options for the per-service "upstream key" picker. Only meaningful where a
	// provider has more than one key (e.g. several Azure resources); single-key
	// providers route automatically, so we leave them out to keep the list short.
	const counts = new Map<string, number>();
	for (const s of secrets) counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1);
	const providerSecrets = secrets
		.filter((s) => (counts.get(s.provider) ?? 0) > 1)
		.map((s) => ({
			id: s.id,
			provider: s.provider,
			providerLabel: PROVIDERS[s.provider]?.label ?? s.provider,
			label: s.label,
			hint: s.hint
		}));
	return {
		policies,
		providerSecrets,
		secrets,
		providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }))
	};
}

/** The create/update payload of a submitted service form, minus the (validated) name. */
export function serviceFromForm(data: FormData) {
	return {
		type: data.get('type')?.toString() || 'app',
		description: data.get('description')?.toString() || null,
		policyId: data.get('policyId')?.toString() || null,
		providerSecretId: data.get('providerSecretId')?.toString() || null,
		...inlineFromForm(data, { includeModels: true })
	};
}
