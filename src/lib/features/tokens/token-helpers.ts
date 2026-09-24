/** Pure helpers behind the tokens page's service picker and preset column. */

/** Must match DEFAULT_SERVICE_NAME on the server (src/lib/server/services.ts). */
export const DEFAULT_SERVICE_NAME = 'Default';

/**
 * Which service the create form starts on: the requested one when it exists,
 * else the real Default service. '' only when Default hasn't been provisioned
 * yet — the server then creates it and assigns the token there.
 */
export function initialServiceId(
	services: { id: string; name: string }[],
	requested?: string | null
): string {
	if (requested && services.some((s) => s.id === requested)) return requested;
	return services.find((s) => s.name === DEFAULT_SERVICE_NAME)?.id ?? '';
}

export type PresetLabel =
	{ source: 'token'; name: string } | { source: 'service'; name: string } | { source: 'none' };

/**
 * The preset shown for a token row. Both the token's and the service's preset
 * apply at request time, but the token's is the more specific one, so it wins
 * the label; the service's is only mentioned when the token has none.
 */
export function tokenPresetLabel(t: {
	policyName: string | null;
	servicePolicyName?: string | null;
}): PresetLabel {
	if (t.policyName) return { source: 'token', name: t.policyName };
	if (t.servicePolicyName) return { source: 'service', name: t.servicePolicyName };
	return { source: 'none' };
}

export interface ServicePickerOption {
	id: string;
	name: string;
	createdAt?: Date | string;
	/** another service has the same name, so the picker must tell them apart */
	duplicate: boolean;
}

/** Services for the picker: Default first, the rest by name, duplicates flagged. */
export function servicePickerOptions(
	services: { id: string; name: string; createdAt?: Date | string }[]
): ServicePickerOption[] {
	const counts = new Map<string, number>();
	for (const s of services) {
		const key = s.name.toLowerCase();
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return services
		.map((s) => ({ ...s, duplicate: (counts.get(s.name.toLowerCase()) ?? 0) > 1 }))
		.sort((a, b) => {
			const aDefault = a.name === DEFAULT_SERVICE_NAME;
			if (aDefault !== (b.name === DEFAULT_SERVICE_NAME)) return aDefault ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
}
