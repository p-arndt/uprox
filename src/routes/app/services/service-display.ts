/** Display helpers for the service list and detail pages. */
import { formatUsd } from '$lib/format';

/** Confirmation copy for deleting a service, which revokes all of its tokens. */
export function deleteServiceDescription(activeTokens: number): string {
	const tail = "This can't be undone.";
	if (activeTokens === 0) return `This service has no active tokens. ${tail}`;
	const noun = activeTokens === 1 ? 'active token' : 'active tokens';
	return `${activeTokens} ${noun} will be revoked and stop working immediately. ${tail}`;
}

export const INHERITED = 'Inherited';

export interface ServiceSettings {
	presetName: string | null;
	rateLimitPerMinute: number | null;
	dailyBudgetUsd: string | number | null;
	monthlyBudgetUsd: string | number | null;
	allowedProviders: string[] | null;
	allowedModels: string[] | null;
	cacheTtlSeconds: number | null;
	upstreamKeyLabel: string | null;
}

export interface SettingRow {
	label: string;
	value: string;
	/** true when the service leaves this to its preset / the instance default */
	inherited: boolean;
}

// The zero and empty values below are explicit settings, not "unset": 0 means
// unlimited/off and an empty allowlist means "allow all" (see schema.ts).
const budget = (v: string | number | null) =>
	v == null ? null : Number(v) === 0 ? 'Unlimited' : formatUsd(v);
const list = (v: string[] | null, label: (s: string) => string) =>
	v == null ? null : v.length === 0 ? 'All' : v.map(label).join(', ');

/** The service's own settings as read-only rows; null columns read "Inherited". */
export function serviceSettingRows(
	s: ServiceSettings,
	providerLabel: (id: string) => string = (id) => id
): SettingRow[] {
	const rows: [string, string | null][] = [
		[
			'Rate limit',
			s.rateLimitPerMinute == null
				? null
				: s.rateLimitPerMinute === 0
					? 'Unlimited'
					: `${s.rateLimitPerMinute} req/min`
		],
		['Daily budget', budget(s.dailyBudgetUsd)],
		['Monthly budget', budget(s.monthlyBudgetUsd)],
		['Allowed providers', list(s.allowedProviders, providerLabel)],
		['Allowed models', list(s.allowedModels, (m) => m)],
		[
			'Cache TTL',
			s.cacheTtlSeconds == null ? null : s.cacheTtlSeconds === 0 ? 'Off' : `${s.cacheTtlSeconds}s`
		]
	];
	const limits = rows.map(([label, value]) => ({
		label,
		value: value ?? INHERITED,
		inherited: value == null
	}));
	// Preset and upstream key are not cascading limits, so a null there is a
	// choice ("none" / "pick the default key"), not something inherited.
	return [
		{ label: 'Preset', value: s.presetName ?? 'None', inherited: false },
		...limits,
		{
			label: 'Upstream key',
			value: s.upstreamKeyLabel ?? 'Automatic (default key)',
			inherited: false
		}
	];
}
