import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { invitation, user } from '$lib/server/db/schema';
import { getEnabledProviders, getOidcConfig, isEmailAuthEnabled } from '$lib/server/auth-config';

/** Only allow internal, single-slash paths to prevent open redirects. */
function safeRedirect(target: string | null | undefined): string {
	if (target && target.startsWith('/') && !target.startsWith('//')) return target;
	return '/app';
}

/** Fetch our own invitation row by id (the row id doubles as the invite token). */
async function findInvitation(id: string) {
	const [row] = await db.select().from(invitation).where(eq(invitation.id, id)).limit(1);
	return row ?? null;
}

export const load: PageServerLoad = async (event) => {
	const inv = await findInvitation(event.params.id);

	if (!inv) {
		return { invalid: true, reason: 'This invitation could not be found.' };
	}

	if (inv.status !== 'pending') {
		const reason =
			inv.status === 'accepted'
				? 'This invitation has already been accepted.'
				: inv.status === 'canceled'
					? 'This invitation has been cancelled.'
					: 'This invitation is no longer valid.';
		return { invalid: true, reason };
	}

	if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
		return { invalid: true, reason: 'This invitation has expired.' };
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
async function loadValidInvitation(event: Parameters<Actions[string]>[0]) {
	const inv = await findInvitation(event.params.id);
	if (!inv || inv.status !== 'pending') {
		return { error: fail(400, { message: 'This invitation is no longer valid.' }) };
	}
	if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
		return { error: fail(400, { message: 'This invitation has expired.' }) };
	}
	return { invitation: inv };
}

/**
 * Accept the invitation for the signed-in user: set their instance role and
 * mark the invite accepted. Requires a logged-in user whose email matches the
 * invited address. Never downgrades an existing owner.
 */
async function acceptAndRedirect(event: Parameters<Actions[string]>[0]) {
	const current = event.locals.user;
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

	// Set the user's instance role to the invited role, but never downgrade an
	// existing owner (the first account stays the owner).
	const [row] = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, current.id))
		.limit(1);
	if (row?.role !== 'owner') {
		await db.update(user).set({ role: inv.role }).where(eq(user.id, current.id));
	}

	// Mark the invitation accepted so the link can't be reused.
	await db.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, inv.id));

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
		try {
			await auth.api.signUpEmail({
				body: { email: inv.email, password, name },
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
