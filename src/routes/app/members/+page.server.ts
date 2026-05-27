import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import { auth } from '$lib/server/auth';
import { listMembers, listPendingInvitations } from '$lib/server/members';

const ROLES = ['admin', 'member'] as const;
type AssignableRole = (typeof ROLES)[number];

function normalizeRole(value: string | undefined): AssignableRole {
	return value === 'admin' ? 'admin' : 'member';
}

export const load: PageServerLoad = async (event) => {
	const ctx = await requireOrg(event);
	const [members, invitations] = await Promise.all([
		listMembers(ctx.organizationId),
		listPendingInvitations(ctx.organizationId)
	]);
	return {
		members,
		invitations,
		currentUserId: ctx.userId,
		inviteBaseUrl: event.url.origin
	};
};

export const actions: Actions = {
	invite: async (event) => {
		await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const email = data.get('email')?.toString().trim();
		const role = normalizeRole(data.get('role')?.toString());
		if (!email) return fail(400, { message: 'Email is required' });

		try {
			await auth.api.createInvitation({
				body: { email, role },
				headers: event.request.headers
			});
			return { invited: true };
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: err.message || 'Failed to send invitation' });
			}
			return fail(500, { message: 'Unexpected error' });
		}
	},

	changeRole: async (event) => {
		const ctx = await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const memberId = data.get('memberId')?.toString();
		const role = normalizeRole(data.get('role')?.toString());
		if (!memberId) return fail(400, { message: 'Missing member' });

		// Prevent self-lockout: don't let the caller change their own role.
		const members = await listMembers(ctx.organizationId);
		const target = members.find((m) => m.id === memberId);
		if (target && target.userId === ctx.userId) {
			return fail(400, { message: 'You cannot change your own role' });
		}

		try {
			await auth.api.updateMemberRole({
				body: { role, memberId },
				headers: event.request.headers
			});
			return { success: true };
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: err.message || 'Failed to update role' });
			}
			return fail(500, { message: 'Unexpected error' });
		}
	},

	remove: async (event) => {
		const ctx = await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const memberIdOrEmail = data.get('memberIdOrEmail')?.toString();
		if (!memberIdOrEmail) return fail(400, { message: 'Missing member' });

		// Prevent removing yourself.
		const members = await listMembers(ctx.organizationId);
		const target = members.find((m) => m.id === memberIdOrEmail);
		if (target && target.userId === ctx.userId) {
			return fail(400, { message: 'You cannot remove yourself' });
		}

		try {
			await auth.api.removeMember({
				body: { memberIdOrEmail },
				headers: event.request.headers
			});
			return { success: true };
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: err.message || 'Failed to remove member' });
			}
			return fail(500, { message: 'Unexpected error' });
		}
	},

	revokeInvite: async (event) => {
		await requirePermission(event, 'members:manage');
		const data = await event.request.formData();
		const invitationId = data.get('invitationId')?.toString();
		if (!invitationId) return fail(400, { message: 'Missing invitation' });

		try {
			await auth.api.cancelInvitation({
				body: { invitationId },
				headers: event.request.headers
			});
			return { success: true };
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: err.message || 'Failed to revoke invitation' });
			}
			return fail(500, { message: 'Unexpected error' });
		}
	}
};
