import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listTraces, getSettings } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [traces, settings] = await Promise.all([listTraces(200), getSettings()]);
	return { traces, tracingEnabled: settings.tracingEnabled };
};
