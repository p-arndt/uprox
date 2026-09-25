import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { orgStats } from '$lib/server/usage-queries/overview';
import { setupChecklistRedirect } from '$lib/server/setup-progress';

/**
 * The instance's front door is the cost analysis — that is what an operator opens
 * uprox to look at. This route only renders the setup checklist when asked for
 * via `/app?setup`, which the cost analysis links to while nothing was proxied.
 */
export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const target = setupChecklistRedirect(event.url);
	if (target) redirect(307, target);
	return { stats: await orgStats() };
};
