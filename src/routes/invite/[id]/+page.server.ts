import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { getEnabledProviders, getOidcConfig, isEmailAuthEnabled } from '$lib/server/auth-config';

/** Only allow internal, single-slash paths to prevent open redirects. */
function safeRedirect(target: string | null | undefined): string {
	if (target && target.startsWith('/') && !target.startsWith('//')) return target;
	return '/app';
}

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
		userEmail: event.locals.user?.email ?? null,
		enabledProviders: getEnabledProviders(),
		oidcLabel: getOidcConfig()?.providerName ?? null
	};
};

/** Re-validate the invitation server-side; returns it or a fail() response. */
async function loadValidInvitation(event: Parameters<Actions[string]>[0]) {
	let invitation;
	try {
		invitation = await auth.api.getInvitation({
			query: { id: event.params.id },
			headers: event.request.headers
		});
	} catch {
		return { error: fail(400, { message: 'This invitation could not be found.' }) };
	}
	if (!invitation || invitation.status !== 'pending') {
		return { error: fail(400, { message: 'This invitation is no longer valid.' }) };
	}
	if (invitation.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now()) {
		return { error: fail(400, { message: 'This invitation has expired.' }) };
	}
	return { invitation };
}

/** Accept the invitation and best-effort set it as the active org. */
async function acceptAndRedirect(event: Parameters<Actions[string]>[0]) {
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

export const actions: Actions = {
	accept: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'You must be signed in to accept this invitation.' });
		}
		return acceptAndRedirect(event);
	},

	register: async (event) => {
		if (!isEmailAuthEnabled()) {
			return fail(403, { message: 'Email registration is disabled; sign in with SSO instead.' });
		}

		const { invitation, error } = await loadValidInvitation(event);
		if (error) return error;

		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim() ?? '';
		const password = data.get('password')?.toString() ?? '';
		const confirmPassword = data.get('confirmPassword')?.toString() ?? '';

		if (!name) {
			return fail(400, { message: 'Please enter your name.', name });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.', name });
		}
		if (password !== confirmPassword) {
			return fail(400, { message: 'Passwords do not match.', name });
		}

		// Email is taken from the invitation only — never from posted form data.
		try {
			await auth.api.signUpEmail({
				body: { email: invitation.email, password, name },
				headers: event.request.headers
			});
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: err.message || 'Registration failed.', name });
			}
			return fail(500, { message: 'Unexpected error during registration.', name });
		}

		return acceptAndRedirect(event);
	},

	oidc: async (event) => {
		if (!getEnabledProviders().oidc) {
			return fail(400, { message: 'SSO is not configured.' });
		}
		// Land back on this invite page (logged-in) so the user can click Accept.
		const callbackURL = safeRedirect(event.url.pathname);
		let res;
		try {
			res = await auth.api.signInWithOAuth2({
				body: { providerId: 'oidc', callbackURL, errorCallbackURL: '/login' },
				headers: event.request.headers
			});
		} catch {
			return fail(500, { message: 'Could not start SSO sign-in.' });
		}
		redirect(302, res.url);
	}
};
