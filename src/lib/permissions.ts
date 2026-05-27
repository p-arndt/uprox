/**
 * Role-based access control for organization resources.
 *
 * This is the single source of truth for *who can mutate what* in the
 * dashboard and REST API. It mirrors the role model of better-auth's
 * organization plugin (`owner` | `admin` | `member`) but governs uprox's own
 * resources (providers, policies, services, tokens, settings, members) — a
 * layer that sits on top of better-auth's internal checks for membership ops.
 *
 * Kept outside `$lib/server` so the dashboard can import `can()` to show/hide
 * controls without a round-trip.
 */

export type Role = 'owner' | 'admin' | 'member';

export type Capability =
	| 'providers:manage'
	| 'policies:manage'
	| 'services:manage'
	| 'tokens:manage'
	| 'pricing:manage'
	| 'settings:manage'
	| 'members:manage';

/**
 * Org-wide toggles that elevate what a plain `member` may do. Stored on
 * `org_settings`; everything defaults to off (members are read-only).
 */
export interface MemberPermissions {
	membersCanManageTokens: boolean;
	membersCanManageServices: boolean;
}

export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
	membersCanManageTokens: false,
	membersCanManageServices: false
};

/** Capabilities granted unconditionally by role. owner ⊇ admin ⊇ member. */
const BASE_CAPS: Record<Role, Capability[]> = {
	owner: [
		'providers:manage',
		'policies:manage',
		'services:manage',
		'tokens:manage',
		'pricing:manage',
		'settings:manage',
		'members:manage'
	],
	admin: [
		'providers:manage',
		'policies:manage',
		'services:manage',
		'tokens:manage',
		'pricing:manage',
		'settings:manage',
		'members:manage'
	],
	// members are read-only by default; the org can opt them into the two
	// capabilities below via settings.
	member: []
};

/**
 * Whether `role` may perform `cap`, taking the org's member-permission
 * settings into account. Unknown roles are treated as `member`.
 */
export function can(
	role: string,
	cap: Capability,
	settings: MemberPermissions = DEFAULT_MEMBER_PERMISSIONS
): boolean {
	const r: Role = role === 'owner' || role === 'admin' ? role : 'member';

	if (BASE_CAPS[r].includes(cap)) return true;

	if (r === 'member') {
		if (cap === 'tokens:manage') return settings.membersCanManageTokens;
		if (cap === 'services:manage') return settings.membersCanManageServices;
	}
	return false;
}
