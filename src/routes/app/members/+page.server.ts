import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	changeMemberRole,
	createInvitation,
	listMembers,
	listPendingInvitations,
	normalizeRole,
	removeMember,
	revokeInvitation
} from '$lib/server/members';
import { sendInvitationEmail } from '$lib/server/email';
import { env } from '$env/dynamic/private';

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
		if (!email) return fail(400, { action: 'invite', message: 'Email is required' });

		const result = await createInvitation({ email, role, inviterId: ctx.userId });
		if ('error' in result)
			return fail(result.error.status, { action: 'invite', message: result.error.message });

		// Best-effort email. When SMTP isn't configured the helper no-ops and the
		// dashboard surfaces a copy-able link in the pending list instead.
		await sendInvitationEmail({
			to: email,
			inviteUrl: `${event.url.origin}/invite/${result.invitation.id}`,
			orgName: env.ORG_NAME?.trim() || 'uprox',
			inviterName: event.locals.user?.name,
			role
		});

		return { success: true, action: 'invite', email };
	},

	changeRole: async (event) => {
		const ctx = await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const memberId = data.get('memberId')?.toString();
		const role = normalizeRole(data.get('role')?.toString());
		if (!memberId) return fail(400, { action: 'changeRole', message: 'Missing member' });

		// Prevent self-lockout: don't let the caller change their own role.
		if (memberId === ctx.userId) {
			return fail(400, { action: 'changeRole', message: 'You cannot change your own role' });
		}

		const err = await changeMemberRole(memberId, role);
		if (err) return fail(err.status, { action: 'changeRole', message: err.message });
		return { success: true, action: 'changeRole', role };
	},

	remove: async (event) => {
		const ctx = await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const memberIdOrEmail = data.get('memberIdOrEmail')?.toString();
		if (!memberIdOrEmail) return fail(400, { action: 'remove', message: 'Missing member' });

		// Prevent removing yourself.
		if (memberIdOrEmail === ctx.userId) {
			return fail(400, { action: 'remove', message: 'You cannot remove yourself' });
		}

		// read before deleting, for the confirmation toast
		const name = (await listMembers()).find((m) => m.id === memberIdOrEmail)?.name;
		const err = await removeMember(memberIdOrEmail);
		if (err) return fail(err.status, { action: 'remove', message: err.message });
		return { success: true, action: 'remove', name };
	},

	revokeInvite: async (event) => {
		await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const invitationId = data.get('invitationId')?.toString();
		if (!invitationId) return fail(400, { action: 'revokeInvite', message: 'Missing invitation' });

		await revokeInvitation(invitationId);
		return { success: true, action: 'revokeInvite' };
	}
};
