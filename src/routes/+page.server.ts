import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	redirect(302, event.locals.user ? '/app' : '/login');
};
