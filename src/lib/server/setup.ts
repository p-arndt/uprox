import { db } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import { sql } from 'drizzle-orm';

/**
 * First-run setup detection.
 *
 * uprox is invite-only: the very first account is created through a one-time
 * `/setup` wizard, and everyone after that joins via an organization
 * invitation (or OIDC). "Setup is complete" simply means at least one user
 * exists.
 *
 * Since a user, once created, is never un-created back to an empty table, the
 * answer is latched to `true` the first time we observe it and cached for the
 * lifetime of the process — so the hot path doesn't hit the DB on every
 * request.
 */
let setupComplete = false;

/** Returns true once at least one user account exists. */
export async function isSetupComplete(): Promise<boolean> {
	if (setupComplete) return true;
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(user)
		.limit(1);
	if (Number(row?.count ?? 0) > 0) setupComplete = true;
	return setupComplete;
}

/** Latch setup as complete (called right after the first admin is created). */
export function markSetupComplete(): void {
	setupComplete = true;
}
