import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getOtelTrace } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const spans = await getOtelTrace(event.params.traceId);
	if (spans.length === 0) error(404, 'Trace not found');
	return { traceId: event.params.traceId, spans };
};
