import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { setupProgress } from '$lib/server/setup-progress';

// The snippets only work once both prerequisites exist, so the page flags what's missing.
export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	return { progress: await setupProgress() };
};
