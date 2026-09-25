import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import {
	getEnabledProviders,
	getOidcConfig,
	isEmailAuthEnabled,
	safeRedirect
} from '$lib/server/auth-config';
import {
	acceptInvitation,
	findInvitation,
	invitationProblem,
	type InvitationProblem
} from '$lib/server/members';

const invalidReasons: Record<InvitationProblem, string> = {
	missing: 'This invitation could not be found.',
	accepted: 'This invitation has already been accepted.',
	canceled: 'This invitation has been cancelled.',
	inactive: 'This invitation is no longer valid.',
	expired: 'This invitation has expired.'
};

export const load: PageServerLoad = async (event) => {
	const inv = await findInvitation(event.params.id);
	const problem = invitationProblem(inv);
	if (problem || !inv) {
		return { invalid: true, reason: invalidReasons[problem ?? 'missing'] };
	}

	return {
		invitation: {
			id: inv.id,
			email: inv.email,
			role: inv.role
		},
		loggedIn: Boolean(event.locals.user),
		userEmail: event.locals.user?.email ?? null,
		enabledProviders: getEnabledProviders(),
		oidcLabel: getOidcConfig()?.providerName ?? null
	};
};

/** Re-validate the invitation server-side; returns it or a fail() response. */
async function loadValidInvitation(event: RequestEvent) {
	const inv = await findInvitation(event.params.id);
	const problem = invitationProblem(inv);
	if (problem === 'expired') {
		return { error: fail(400, { message: 'This invitation has expired.' }) };
	}
	if (problem || !inv) {
		return { error: fail(400, { message: 'This invitation is no longer valid.' }) };
	}
	return { invitation: inv };
}

/**
 * Accept the invitation for the signed-in user. Requires a logged-in user whose
 * email matches the invited address.
 */
async function acceptAndRedirect(
	event: RequestEvent,
	current: { id: string; email: string } | null | undefined = event.locals.user
) {
	if (!current) {
		return fail(401, { message: 'You must be signed in to accept this invitation.' });
	}

	const { invitation: inv, error } = await loadValidInvitation(event);
	if (error) return error;

	// Security: only the invited address may accept the invitation.
	if (current.email.toLowerCase() !== inv.email.toLowerCase()) {
		return fail(403, {
			message: 'This invitation was sent to a different email address.'
		});
	}

	await acceptInvitation(current.id, inv);
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

		const { invitation: inv, error } = await loadValidInvitation(event);
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
		let created;
		try {
			created = await auth.api.signUpEmail({
				body: { email: inv.email, password, name },
				headers: event.request.headers
			});
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: err.message || 'Registration failed.', name });
			}
			return fail(500, { message: 'Unexpected error during registration.', name });
		}

		// locals.user was resolved before this account existed, so accept for the
		// user sign-up just created rather than the request's empty session.
		return acceptAndRedirect(event, created.user);
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
