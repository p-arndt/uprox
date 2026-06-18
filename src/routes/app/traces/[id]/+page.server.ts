import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getTrace, listTraceGroup } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const trace = await getTrace(event.params.id);
	if (!trace) error(404, 'Trace not found');
	// when the call belongs to a caller-supplied session, load its siblings so the
	// detail view can render the whole run as a tree/waterfall.
	const group = trace.groupId ? await listTraceGroup(trace.groupId) : [];
	return { trace, group };
};
