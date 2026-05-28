import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import {
	getEnabledProviders,
	getOidcConfig,
	isEmailAuthEnabled
} from '$lib/server/auth-config';
import { markSetupComplete } from '$lib/server/setup';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) redirect(303, '/app');
	return {
		enabledProviders: getEnabledProviders(),
		oidcLabel: getOidcConfig()?.providerName ?? null
	};
};

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const name = data.get('name')?.toString().trim() ?? '';
		const email = data.get('email')?.toString().trim() ?? '';
		const password = data.get('password')?.toString() ?? '';
		const confirmPassword = data.get('confirmPassword')?.toString() ?? '';

		if (!isEmailAuthEnabled()) {
			return fail(400, { message: 'Email/password sign-up is disabled.' });
		}

		if (!name || !email || !password || !confirmPassword) {
			return fail(400, { message: 'All fields are required.', name, email });
		}
		if (!email.includes('@')) {
			return fail(400, { message: 'Please enter a valid email address.', name, email });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.', name, email });
		}
		if (password !== confirmPassword) {
			return fail(400, { message: 'Passwords do not match.', name, email });
		}

		try {
			await auth.api.signUpEmail({
				body: { email, password, name },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					message: error.message || 'Could not create the admin account.',
					name,
					email
				});
			}
			return fail(500, {
				message: 'An unexpected error occurred while creating the admin account.',
				name,
				email
			});
		}

		markSetupComplete();
		redirect(303, '/app');
	},
	// Bootstrap via OIDC: the first user to complete the OAuth flow becomes the
	// owner of their auto-provisioned organization (see databaseHooks.user.create
	// in auth.ts), which is the only "admin" concept the platform currently has.
	oidc: async (event) => {
		if (!getEnabledProviders().oidc) {
			return fail(400, { message: 'SSO is not configured.' });
		}
		let res;
		try {
			res = await auth.api.signInWithOAuth2({
				body: { providerId: 'oidc', callbackURL: '/app', errorCallbackURL: '/setup' },
				headers: event.request.headers
			});
		} catch {
			return fail(500, { message: 'Could not start SSO sign-in.' });
		}
		redirect(302, res.url);
	}
};
