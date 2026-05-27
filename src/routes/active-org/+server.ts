import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	const form = await event.request.formData();
	const organizationId = form.get('organizationId');

	if (typeof organizationId === 'string' && organizationId.length > 0) {
		try {
			await auth.api.setActiveOrganization({
				body: { organizationId },
				headers: event.request.headers
			});
		} catch {
			// ignore: fall through to redirect, active org stays unchanged
		}
	}

	redirect(303, '/app');
};
