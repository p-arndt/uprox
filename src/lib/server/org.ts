import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { can, type Capability } from '$lib/permissions';
import { getSettings } from '$lib/server/data';

/**
 * Access context for the current request. The whole self-hosted instance is a
 * single workspace, so there is no organization to resolve — a user's
 * instance-wide `role` is the entire access model.
 */
export interface OrgContext {
	userId: string;
	role: string;
}

/**
 * Resolve the signed-in user and their instance role. Returns null when the
 * user is signed out or their account no longer exists.
 */
export async function getOrgContext(event: RequestEvent): Promise<OrgContext | null> {
	const u = event.locals.user;
	if (!u) return null;

	const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, u.id)).limit(1);

	if (!row) return null;
	return { userId: u.id, role: row.role };
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

/**
 * Require the caller to hold a capability. Resolves the access context, checks
 * the role against the capability matrix (taking the member-permission settings
 * into account), and throws 401/403 otherwise.
 *
 * Use this in mutating API routes and page actions; use {@link can} in load
 * functions / components to show or hide the corresponding controls.
 */
export async function requirePermission(event: RequestEvent, cap: Capability): Promise<OrgContext> {
	const ctx = await requireOrgApi(event);
	const settings = await getSettings();
	if (!can(ctx.role, cap, settings)) {
		throw error(403, 'You do not have permission to perform this action');
	}
	return ctx;
}

/** Require the caller's role to be one of `roles`. */
export async function requireRole(
	event: RequestEvent,
	roles: readonly string[]
): Promise<OrgContext> {
	const ctx = await requireOrgApi(event);
	if (!roles.includes(ctx.role)) {
		throw error(403, 'You do not have permission to perform this action');
	}
	return ctx;
}
