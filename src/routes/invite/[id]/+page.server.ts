import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';

export const load: PageServerLoad = async (event) => {
	let invitation;
	try {
		invitation = await auth.api.getInvitation({
			query: { id: event.params.id },
			headers: event.request.headers
		});
	} catch {
		return { invalid: true, reason: 'This invitation could not be found.' };
	}

	if (!invitation) {
		return { invalid: true, reason: 'This invitation could not be found.' };
	}

	if (invitation.status !== 'pending') {
		const reason =
			invitation.status === 'accepted'
				? 'This invitation has already been accepted.'
				: invitation.status === 'canceled'
					? 'This invitation has been cancelled.'
					: 'This invitation is no longer valid.';
		return { invalid: true, reason };
	}

	if (invitation.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now()) {
		return { invalid: true, reason: 'This invitation has expired.' };
	}

	return {
		invitation: {
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			organizationName: invitation.organizationName
		},
		loggedIn: Boolean(event.locals.user),
		userEmail: event.locals.user?.email ?? null
	};
};

export const actions: Actions = {
	accept: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'You must be signed in to accept this invitation.' });
		}

		let organizationId: string | undefined;
		try {
			const result = await auth.api.acceptInvitation({
				body: { invitationId: event.params.id },
				headers: event.request.headers
			});
			organizationId = result?.invitation?.organizationId;
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: error.message || 'Could not accept invitation.' });
			}
			return fail(500, { message: 'Unexpected error accepting invitation.' });
		}

		// Best-effort: make the joined org the active one for this session.
		if (organizationId) {
			try {
				await auth.api.setActiveOrganization({
					body: { organizationId },
					headers: event.request.headers
				});
			} catch {
				// ignore — the dashboard will still resolve an active org.
			}
		}

		redirect(303, '/app');
	}
};
