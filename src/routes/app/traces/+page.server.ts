import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listTraceFeed, listOtelTraces, getSettings } from '$lib/server/data';
import { parseMetaFilter } from '$lib/trace';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const metaFilter = parseMetaFilter(event.url.searchParams.get('meta'));
	const [feed, otelTraces, settings] = await Promise.all([
		listTraceFeed(200, metaFilter),
		listOtelTraces(100),
		getSettings()
	]);
	return { feed, otelTraces, tracingEnabled: settings.tracingEnabled, metaFilter };
};
