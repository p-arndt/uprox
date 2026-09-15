import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user, invitation } from '$lib/server/db/schema';

/** Roles an admin can hand out; `owner` is reserved for the first account. */
export type AssignableRole = 'admin' | 'member';

/** Invitations expire after 7 days. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Invitation = typeof invitation.$inferSelect;

/** A rejected member operation: the HTTP status and a user-facing message. */
export interface MemberError {
	status: 400 | 403;
	message: string;
}

/** Coerce a posted role to an assignable one, defaulting to `member`. */
export function normalizeRole(value: string | undefined): AssignableRole {
	return value === 'admin' ? 'admin' : 'member';
}

/**
 * List all instance members (users), oldest first. Both `id` and `userId` map
 * to the user's id so callers that access either field keep working.
 */
export function listMembers() {
	return db
		.select({
			id: user.id,
			userId: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(user.createdAt);
}

/**
 * List outstanding (status = 'pending') invitations for the instance, newest
 * first. There is no organization scope — invitations provision instance-wide
 * user accounts.
 */
export function listPendingInvitations() {
	return db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			createdAt: invitation.createdAt
		})
		.from(invitation)
		.where(eq(invitation.status, 'pending'))
		.orderBy(desc(invitation.createdAt));
}

async function userRole(userId: string): Promise<string | null> {
	const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1);
	return row?.role ?? null;
}

/**
 * Create a pending invitation. Rejects addresses that already belong to a user
 * or already have a pending invitation.
 */
export async function createInvitation(input: {
	email: string;
	role: AssignableRole;
	inviterId: string;
}): Promise<{ invitation: Invitation } | { error: MemberError }> {
	const [[existingUser], [existingInvite]] = await Promise.all([
		db.select({ id: user.id }).from(user).where(eq(user.email, input.email)).limit(1),
		db
			.select({ id: invitation.id })
			.from(invitation)
			.where(and(eq(invitation.email, input.email), eq(invitation.status, 'pending')))
			.limit(1)
	]);
	if (existingUser) {
		return { error: { status: 400, message: 'A user with that email already exists' } };
	}
	if (existingInvite) {
		return {
			error: { status: 400, message: 'There is already a pending invitation for that email' }
		};
	}

	const [inv] = await db
		.insert(invitation)
		.values({
			email: input.email,
			role: input.role,
			inviterId: input.inviterId,
			expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
			status: 'pending'
		})
		.returning();
	if (!inv) throw new Error('Invitation insert returned no row');
	return { invitation: inv };
}

/** Change a member's role. The owner role is immutable, even for admins. */
export async function changeMemberRole(
	memberId: string,
	role: AssignableRole
): Promise<MemberError | null> {
	if ((await userRole(memberId)) === 'owner') {
		return { status: 403, message: 'The owner role cannot be changed.' };
	}
	await db.update(user).set({ role }).where(eq(user.id, memberId));
	return null;
}

/** Remove a member; deleting the user cascades their sessions and accounts. The owner can't be removed. */
export async function removeMember(memberId: string): Promise<MemberError | null> {
	if ((await userRole(memberId)) === 'owner') {
		return { status: 403, message: 'The owner cannot be removed.' };
	}
	await db.delete(user).where(eq(user.id, memberId));
	return null;
}

/** Cancel a pending invitation so its link stops working. */
export async function revokeInvitation(invitationId: string): Promise<void> {
	await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, invitationId));
}

/** Fetch an invitation by id (the row id doubles as the invite token). */
export async function findInvitation(id: string): Promise<Invitation | null> {
	const [row] = await db.select().from(invitation).where(eq(invitation.id, id)).limit(1);
	return row ?? null;
}

/** True when `email` has a pending, unexpired invitation (case-insensitive). */
export async function hasValidInvitation(email: string): Promise<boolean> {
	const rows = await db
		.select({ status: invitation.status, expiresAt: invitation.expiresAt })
		.from(invitation)
		.where(
			and(
				eq(sql`lower(${invitation.email})`, email.toLowerCase()),
				eq(invitation.status, 'pending')
			)
		);
	return rows.some((inv) => invitationProblem(inv) === null);
}

/** Why an invitation can't be used, or null when it's valid. */
export type InvitationProblem = 'missing' | 'accepted' | 'canceled' | 'inactive' | 'expired';

export function invitationProblem(
	inv: Pick<Invitation, 'status' | 'expiresAt'> | null,
	now = Date.now()
): InvitationProblem | null {
	if (!inv) return 'missing';
	if (inv.status !== 'pending') {
		return inv.status === 'accepted' || inv.status === 'canceled' ? inv.status : 'inactive';
	}
	if (inv.expiresAt && new Date(inv.expiresAt).getTime() < now) return 'expired';
	return null;
}

/**
 * Accept an invitation for a user: grant the invited role (never downgrading
 * an existing owner) and mark the invitation accepted so the link can't be reused.
 */
export async function acceptInvitation(userId: string, inv: Invitation): Promise<void> {
	if ((await userRole(userId)) !== 'owner') {
		await db.update(user).set({ role: inv.role }).where(eq(user.id, userId));
	}
	await db.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, inv.id));
}
