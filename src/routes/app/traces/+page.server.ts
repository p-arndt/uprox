import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { listTraces, listOtelTraces, getSettings } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const [traces, otelTraces, settings] = await Promise.all([
		listTraces(200),
		listOtelTraces(100),
		getSettings()
	]);
	return { traces, otelTraces, tracingEnabled: settings.tracingEnabled };
};
