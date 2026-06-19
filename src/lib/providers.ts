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
