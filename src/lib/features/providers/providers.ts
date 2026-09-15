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
	label: string;
	requiresEndpoint: boolean;
	baseUrl: string;
	priority: number;
}
