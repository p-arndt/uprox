/** Pure filter / group / sort logic behind the machine-token table. */
import { tokenStatus, type Token } from './tokens';
import { tokenPresetLabel } from './token-helpers';

/** 'current' hides revoked tokens: they are kept for the audit trail but dead. */
export type TokenStatusFilter = 'current' | 'active' | 'expired' | 'revoked' | 'all';

export const STATUS_FILTER_OPTIONS: { value: TokenStatusFilter; label: string }[] = [
	{ value: 'current', label: 'Not revoked' },
	{ value: 'active', label: 'Active' },
	{ value: 'expired', label: 'Expired' },
	{ value: 'revoked', label: 'Revoked' },
	{ value: 'all', label: 'Any status' }
];

export function matchesStatus(t: Token, filter: TokenStatusFilter): boolean {
	const label = tokenStatus(t).label;
	if (filter === 'all') return true;
	if (filter === 'current') return label !== 'revoked';
	return label === filter;
}

/** Free-text match over everything a row displays; `q` is already lowercased. */
export function matchesQuery(t: Token, q: string): boolean {
	const preset = tokenPresetLabel(t);
	return [
		t.name,
		t.display,
		t.serviceName,
		preset.source === 'none' ? '' : preset.name,
		...t.scopes,
		...t.allowedModels
	]
		.join(' ')
		.toLowerCase()
		.includes(q);
}

export type TokenGrouping = 'none' | 'service' | 'status' | 'preset';

export const GROUPING_OPTIONS: { value: TokenGrouping; label: string }[] = [
	{ value: 'none', label: 'No grouping' },
	{ value: 'service', label: 'Group by service' },
	{ value: 'status', label: 'Group by status' },
	{ value: 'preset', label: 'Group by preset' }
];

export interface TokenGroup {
	key: string;
	label: string;
	/** set when the group is a service, so the header can link to it */
	serviceId?: string;
	tokens: Token[];
}

const STATUS_ORDER = ['active', 'expired', 'revoked'];
const NO_PRESET = 'No preset';

/**
 * Splits already-sorted rows into groups, keeping the row order inside each
 * group. Groups are ordered by label, except status (lifecycle order) and the
 * "no preset" bucket (last, since it is the absence of a grouping value).
 */
export function groupTokens(tokens: Token[], by: TokenGrouping): TokenGroup[] {
	if (by === 'none') return [{ key: 'all', label: '', tokens }];

	const groups = new Map<string, TokenGroup>();
	for (const t of tokens) {
		let key: string;
		let label: string;
		let serviceId: string | undefined;
		if (by === 'service') {
			key = t.serviceId;
			label = t.serviceName;
			serviceId = t.serviceId;
		} else if (by === 'status') {
			key = label = tokenStatus(t).label;
		} else {
			// The effective preset (token's own, else the service's) is what
			// actually constrains the token, so that is what it groups under.
			const preset = tokenPresetLabel(t);
			key = label = preset.source === 'none' ? NO_PRESET : preset.name;
		}
		const group = groups.get(key) ?? { key, label, serviceId, tokens: [] };
		group.tokens.push(t);
		groups.set(key, group);
	}

	const list = [...groups.values()];
	if (by === 'status') {
		return list.sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
	}
	return list.sort((a, b) => {
		if (by === 'preset' && (a.key === NO_PRESET) !== (b.key === NO_PRESET)) {
			return a.key === NO_PRESET ? 1 : -1;
		}
		return a.label.localeCompare(b.label);
	});
}

const time = (v: Date | string | null) => (v ? new Date(v).getTime() : 0);

export const TOKEN_SORTERS: Record<string, (a: Token, b: Token) => number> = {
	name: (a, b) => a.name.localeCompare(b.name),
	service: (a, b) => a.serviceName.localeCompare(b.serviceName) || a.name.localeCompare(b.name),
	lastUsed: (a, b) => time(a.lastUsedAt) - time(b.lastUsedAt),
	status: (a, b) =>
		STATUS_ORDER.indexOf(tokenStatus(a).label) - STATUS_ORDER.indexOf(tokenStatus(b).label),
	created: (a, b) => time(a.createdAt) - time(b.createdAt)
};

/**
 * Revoked tokens hidden by the default "Not revoked" filter. The filter is on
 * without the user choosing it, so the counts must say why rows are missing.
 */
export function hiddenRevokedCount(tokens: Token[], filter: TokenStatusFilter): number {
	if (filter !== 'current') return 0;
	return tokens.filter((t) => tokenStatus(t).label === 'revoked').length;
}
