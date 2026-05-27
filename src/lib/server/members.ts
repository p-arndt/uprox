import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { member, user, invitation } from '$lib/server/db/schema';

/**
 * List an organization's members joined with their user profile, oldest first.
 */
export function listMembers(orgId: string) {
	return db
		.select({
			id: member.id,
			userId: member.userId,
			name: user.name,
			email: user.email,
			role: member.role,
			createdAt: member.createdAt
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, orgId))
		.orderBy(member.createdAt);
}

/**
 * List an organization's outstanding (status = 'pending') invitations,
 * newest first.
 */
export function listPendingInvitations(orgId: string) {
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
		.where(and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending')))
		.orderBy(desc(invitation.createdAt));
}
