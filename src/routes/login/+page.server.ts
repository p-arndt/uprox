import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) redirect(302, '/app');
	return {};
};

export const actions: Actions = {
	signIn: async (event) => {
		const data = await event.request.formData();
		const email = data.get('email')?.toString() ?? '';
		const password = data.get('password')?.toString() ?? '';
		try {
			await auth.api.signInEmail({ body: { email, password }, headers: event.request.headers });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { mode: 'signIn', email, message: error.message || 'Sign in failed' });
			}
			return fail(500, { mode: 'signIn', email, message: 'Unexpected error' });
		}
		redirect(302, '/app');
	},
	signUp: async (event) => {
		const data = await event.request.formData();
		const email = data.get('email')?.toString() ?? '';
		const password = data.get('password')?.toString() ?? '';
		const name = data.get('name')?.toString() ?? '';
		try {
			await auth.api.signUpEmail({
				body: { email, password, name },
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					mode: 'signUp',
					email,
					name,
					message: error.message || 'Registration failed'
				});
			}
			return fail(500, { mode: 'signUp', email, name, message: 'Unexpected error' });
		}
		redirect(302, '/app');
	}
};
