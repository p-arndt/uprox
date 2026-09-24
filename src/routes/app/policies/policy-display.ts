/** Text for the preset cards and dialogs. */
import { formatBudget } from '$lib/format';

export interface PolicyUsage {
	services: number;
	tokens: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Used by 3 services · 12 tokens", or "Not used yet". */
export function usageText(u: PolicyUsage): string {
	if (u.services === 0 && u.tokens === 0) return 'Not used yet';
	return `Used by ${plural(u.services, 'service')} · ${plural(u.tokens, 'token')}`;
}

/** "Rate: unlimited" / "Rate: 60/min per token". */
export function rateText(perMinute: number): string {
	return perMinute > 0 ? `Rate: ${perMinute}/min per token` : 'Rate: unlimited';
}

/** "Budget: unlimited" / "Budget: $5/day · $50/mo". */
export function budgetText(daily: string | number, monthly: string | number): string {
	const b = formatBudget(daily, monthly);
	return `Budget: ${b === 'No budget' ? 'unlimited' : b}`;
}

/** "Cache: instance default" / "Cache: off" / "Cache: 60 s". */
export function cacheText(ttlSeconds: number | null): string {
	if (ttlSeconds == null) return 'Cache: instance default';
	return ttlSeconds === 0 ? 'Cache: off' : `Cache: ${ttlSeconds} s`;
}

/** The edit dialog's description: who a change reaches. */
export function editDescription(u: PolicyUsage): string {
	if (u.services === 0 && u.tokens === 0) {
		return 'Not attached to any service or token yet.';
	}
	return `Changes apply right away to the ${plural(u.services, 'service')} and ${plural(u.tokens, 'token')} using this preset, except where they override a value.`;
}

/** The delete confirmation: what actually happens to whatever uses the preset. */
export function deleteDescription(u: PolicyUsage): string {
	if (u.services === 0 && u.tokens === 0) {
		return 'No service or token uses this preset. This can’t be undone.';
	}
	return (
		`${plural(u.services, 'service')} and ${plural(u.tokens, 'token')} use this preset. ` +
		'They will be detached and fall back to their own overrides and the instance defaults, ' +
		'so limits and access rules that came only from this preset are lost. This can’t be undone.'
	);
}
