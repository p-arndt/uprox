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

export const load: PageServerLoad = (event) => {
	const redirectTo = safeRedirect(event.url.searchParams.get('redirectTo'));
	if (event.locals.user) redirect(302, redirectTo);
	return {
		redirectTo,
		enabledProviders: getEnabledProviders(),
		oidcLabel: getOidcConfig()?.providerName ?? null
	};
};

export const actions: Actions = {
	signIn: async (event) => {
		if (!isEmailAuthEnabled()) {
			return fail(403, { mode: 'signIn', message: 'Email sign-in is disabled.' });
		}
		const data = await event.request.formData();
		const email = data.get('email')?.toString() ?? '';
		const password = data.get('password')?.toString() ?? '';
		const redirectTo = safeRedirect(data.get('redirectTo')?.toString());
		try {
			await auth.api.signInEmail({ body: { email, password }, headers: event.request.headers });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { mode: 'signIn', email, message: error.message || 'Sign in failed' });
			}
			return fail(500, { mode: 'signIn', email, message: 'Unexpected error' });
		}
		redirect(302, redirectTo);
	},
	oidc: async (event) => {
		if (!getEnabledProviders().oidc) {
			return fail(400, { message: 'SSO is not configured.' });
		}
		const data = await event.request.formData();
		const redirectTo = safeRedirect(data.get('redirectTo')?.toString());
		let res;
		try {
			res = await auth.api.signInWithOAuth2({
				body: { providerId: 'oidc', callbackURL: redirectTo, errorCallbackURL: '/login' },
				headers: event.request.headers
			});
		} catch {
			return fail(500, { message: 'Could not start SSO sign-in.' });
		}
		redirect(302, res.url);
	}
};
