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
