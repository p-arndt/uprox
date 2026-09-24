import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { orgStats } from '$lib/server/usage-queries/overview';
import { setupChecklistRedirect } from '$lib/server/setup-progress';

/**
 * The instance's front door is the cost analysis — that is what an operator opens
 * uprox to look at. This route only exists for the state where that page has
 * nothing to show: a fresh instance with no proxied request yet, which gets the
 * setup checklist instead. The moment one request has landed, the checklist is
 * finished by definition and we hand over — except for `/app?setup`, which the
 * cost analysis links to and must not bounce back from.
 */
export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const stats = await orgStats();
	const target = setupChecklistRedirect(stats.requests, event.url);
	if (target) redirect(307, target);
	return { stats };
};
