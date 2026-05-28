import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user, invitation } from '$lib/server/db/schema';

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
