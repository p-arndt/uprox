/** Client-side provider-secret types and helpers for the Providers page. */

/** A provider secret row as listed on the providers page. */
export interface ProviderSecret {
	id: string;
	provider: string;
	label: string | null;
	baseUrl: string | null;
	priority: number;
	hint: string | null;
	createdAt: Date | string;
	updatedAt: Date | string;
}

/** The host of an endpoint URL, for a compact secondary label. */
export function endpointHost(url: string | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** The provider a new key is being added to (the add-key dialog's payload). */
export interface ProviderKeyDraft {
	provider: string;
	label: string;
	requiresEndpoint: boolean;
	authScheme: string;
	optionalAuth: boolean;
	/** the provider already holds a key; the first one hides label/priority as advanced */
	hasKeys: boolean;
}

/**
 * The key-field placeholder for a provider, shaped like its real keys so a
 * pasted key from the wrong console stands out (Gemini keys aren't "sk-…").
 */
export function keyPlaceholder(provider: string | undefined): string {
	switch (provider) {
		case 'openai':
			return 'sk-proj-…';
		case 'anthropic':
			return 'sk-ant-…';
		case 'gemini':
			return 'AIza…';
		case 'azure':
			return 'Key 1 or Key 2 from the Azure portal';
		default:
			return 'API key';
	}
}

/** An example label, so operators see what telling several keys apart looks like. */
export function labelPlaceholder(provider: string | undefined): string {
	switch (provider) {
		case 'azure':
			return 'e.g. Azure East US';
		case 'ollama':
			return 'e.g. GPU server';
		case 'custom':
			return 'e.g. Groq';
		default:
			return 'e.g. Production';
	}
}

/** "key" or "endpoint": endpoint providers are configured by their URL, not a key. */
export function credentialNoun(requiresEndpoint: boolean): 'key' | 'endpoint' {
	return requiresEndpoint ? 'endpoint' : 'key';
}

/**
 * The masked credential shown on a key row. An empty hint means an optional-auth
 * provider (Ollama) stored no credential at all, which "••••" would misrepresent.
 */
export function maskedHint(hint: string | null): string {
	return hint ? `••••${hint}` : 'No auth';
}

/** The secret whose key is being rotated (the rotate-key dialog's payload). */
export interface RotateKeyDraft {
	id: string;
	label: string;
	provider: string;
	authScheme: string;
	optionalAuth: boolean;
}

/** The secret whose label / endpoint / priority is being edited. */
export interface ProviderMetaDraft {
	id: string;
	provider: string;
	/** the provider's display name, for the dialog title */
	providerLabel: string;
	label: string;
	requiresEndpoint: boolean;
	baseUrl: string;
	priority: number;
}

/** A connection test's result as the `test` action returns it. */
export type ConnectionTestOutcome =
	{ status: 'ok' } | { status: 'failed'; message: string } | { status: 'skipped'; message: string };

/** The toast a per-row "Test" shows. */
export function connectionTestToast(outcome: ConnectionTestOutcome): {
	kind: 'success' | 'error' | 'info';
	message: string;
} {
	if (outcome.status === 'ok') return { kind: 'success', message: 'Connection OK' };
	if (outcome.status === 'failed') return { kind: 'error', message: outcome.message };
	return { kind: 'info', message: outcome.message };
}

/** The success toast after a providers-page action, or null for actions that don't toast. */
export function savedToast(action: string | undefined, tested?: boolean): string | null {
	switch (action) {
		case 'create':
			return tested ? 'Connection verified, saved' : 'Saved';
		case 'rotate':
			return tested ? 'Connection verified, key rotated' : 'Key rotated';
		case 'editMeta':
			return 'Details saved';
		case 'delete':
			return 'Key removed';
		default:
			return null;
	}
}
