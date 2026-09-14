import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listTraceFeed, listOtelTraces } from '$lib/server/traces-queries';
import { getSettings } from '$lib/server/settings';
import { parseMetaFilter } from '$lib/features/traces/trace';

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
