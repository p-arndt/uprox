import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { member } from '$lib/server/db/schema';

export interface OrgContext {
	userId: string;
	organizationId: string;
	role: string;
}

/**
 * Resolve the caller's active organization and membership role.
 *
 * Prefers the session's `activeOrganizationId` (set by better-auth's
 * organization plugin) and falls back to the user's first membership.
 * Returns null when the user is signed out or has no membership.
 */
export async function getOrgContext(event: RequestEvent): Promise<OrgContext | null> {
	const user = event.locals.user;
	if (!user) return null;

	const activeId = (event.locals.session as { activeOrganizationId?: string } | undefined)
		?.activeOrganizationId;

	const where = activeId
		? and(eq(member.userId, user.id), eq(member.organizationId, activeId))
		: eq(member.userId, user.id);

	const [m] = await db
		.select({ organizationId: member.organizationId, role: member.role })
		.from(member)
		.where(where)
		.limit(1);

	if (!m) return null;
	return { userId: user.id, organizationId: m.organizationId, role: m.role };
}

/** Like {@link getOrgContext} but redirects to /login when signed out. */
export async function requireOrg(event: RequestEvent): Promise<OrgContext> {
	const ctx = await getOrgContext(event);
	if (!ctx) throw redirect(302, '/login');
	return ctx;
}

/** API variant: throws 401 JSON instead of redirecting. */
export async function requireOrgApi(event: RequestEvent): Promise<OrgContext> {
	const ctx = await getOrgContext(event);
	if (!ctx) throw error(401, 'Not authenticated');
	return ctx;
}
