import { can, type Capability, type MemberPermissions } from '$lib/permissions';

/**
 * Nav pages anyone may open but only some roles may change. They stay in the
 * nav (members still read the member list and the cache default) but are
 * marked, so nobody walks in expecting to edit.
 */
const MANAGE_CAPABILITY: Partial<Record<string, Capability>> = {
	'/app/members': 'members:manage',
	'/app/settings': 'settings:manage'
};

/** Whether the nav entry at `href` is read-only for this role. */
export function viewOnlyNav(
	href: string,
	role: string,
	memberPermissions?: MemberPermissions
): boolean {
	const cap = MANAGE_CAPABILITY[href];
	return cap !== undefined && !can(role, cap, memberPermissions);
}
