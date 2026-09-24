/** Role choices and badge styling shared by the members page tables and invite dialog. */

/** The roles an admin can assign; owner is never assignable from the UI. */
export const roleOptions = [
	{ value: 'member', label: 'Member' },
	{ value: 'admin', label: 'Admin' }
];

/** The display label of an assignable role, else the raw role. */
export const roleLabel = (role: string): string =>
	roleOptions.find((o) => o.value === role)?.label ?? role;

/** Badge variant for a role: owner stands out most, member least. */
export function roleVariant(role: string): 'default' | 'secondary' | 'outline' {
	if (role === 'owner') return 'default';
	if (role === 'admin') return 'secondary';
	return 'outline';
}

/**
 * Whether moving a member from `from` to `to` grants them more power. Those
 * changes are confirmed first: one misclick in the inline select would
 * otherwise hand someone full admin rights.
 */
export function isEscalation(from: string, to: string): boolean {
	const rank = (role: string) => (role === 'owner' ? 2 : role === 'admin' ? 1 : 0);
	return rank(to) > rank(from);
}

/** What the org's member-permission toggles currently let plain members manage. */
export function memberGrants(settings: {
	membersCanManageTokens: boolean;
	membersCanManageServices: boolean;
}): string[] {
	const grants: string[] = [];
	if (settings.membersCanManageTokens) grants.push('machine tokens');
	if (settings.membersCanManageServices) grants.push('services');
	return grants;
}
