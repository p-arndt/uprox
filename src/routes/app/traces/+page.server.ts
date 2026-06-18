import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listTraceFeed, listOtelTraces, getSettings } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [feed, otelTraces, settings] = await Promise.all([
		listTraceFeed(200),
		listOtelTraces(100),
		getSettings()
	]);
	return { feed, otelTraces, tracingEnabled: settings.tracingEnabled };
};
