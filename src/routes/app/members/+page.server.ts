import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user, invitation } from '$lib/server/db/schema';
import { requireOrg, requirePermission } from '$lib/server/org';
import { listMembers, listPendingInvitations } from '$lib/server/members';
import { sendInvitationEmail } from '$lib/server/email';
import { env } from '$env/dynamic/private';

const ROLES = ['admin', 'member'] as const;
type AssignableRole = (typeof ROLES)[number];

function normalizeRole(value: string | undefined): AssignableRole {
	return value === 'admin' ? 'admin' : 'member';
}

export const load: PageServerLoad = async (event) => {
	const { userId } = await requireOrg(event);
	const [members, invitations] = await Promise.all([listMembers(), listPendingInvitations()]);
	return {
		members,
		invitations,
		currentUserId: userId,
		inviteBaseUrl: event.url.origin
	};
};

export const actions: Actions = {
	invite: async (event) => {
		const ctx = await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const email = data.get('email')?.toString().trim();
		const role = normalizeRole(data.get('role')?.toString());
		if (!email) return fail(400, { message: 'Email is required' });

		// Reject if the address already belongs to a user or has a pending invite.
		const [existingUser] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email))
			.limit(1);
		if (existingUser) {
			return fail(400, { message: 'A user with that email already exists' });
		}
		const [existingInvite] = await db
			.select({ id: invitation.id })
			.from(invitation)
			.where(and(eq(invitation.email, email), eq(invitation.status, 'pending')))
			.limit(1);
		if (existingInvite) {
			return fail(400, { message: 'There is already a pending invitation for that email' });
		}

		// 7-day expiry, matching the previous invitation lifetime.
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
		const [inv] = await db
			.insert(invitation)
			.values({ email, role, inviterId: ctx.userId, expiresAt, status: 'pending' })
			.returning();

		// Best-effort email. When SMTP isn't configured the helper no-ops and the
		// dashboard surfaces a copy-able link in the pending list instead.
		await sendInvitationEmail({
			to: email,
			inviteUrl: `${event.url.origin}/invite/${inv.id}`,
			orgName: env.ORG_NAME?.trim() || 'uprox',
			inviterName: event.locals.user?.name,
			role
		});

		return { invited: true };
	},

	changeRole: async (event) => {
		const ctx = await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const memberId = data.get('memberId')?.toString();
		const role = normalizeRole(data.get('role')?.toString());
		if (!memberId) return fail(400, { message: 'Missing member' });

		// Prevent self-lockout: don't let the caller change their own role.
		if (memberId === ctx.userId) {
			return fail(400, { message: 'You cannot change your own role' });
		}

		await db.update(user).set({ role }).where(eq(user.id, memberId));
		return { success: true };
	},

	remove: async (event) => {
		const ctx = await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const memberIdOrEmail = data.get('memberIdOrEmail')?.toString();
		if (!memberIdOrEmail) return fail(400, { message: 'Missing member' });

		// Prevent removing yourself.
		if (memberIdOrEmail === ctx.userId) {
			return fail(400, { message: 'You cannot remove yourself' });
		}

		// Deleting the user cascades their sessions and accounts.
		await db.delete(user).where(eq(user.id, memberIdOrEmail));
		return { success: true };
	},

	revokeInvite: async (event) => {
		await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const invitationId = data.get('invitationId')?.toString();
		if (!invitationId) return fail(400, { message: 'Missing invitation' });

		await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, invitationId));
		return { success: true };
	}
};
