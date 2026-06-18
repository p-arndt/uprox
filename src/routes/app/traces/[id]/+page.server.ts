import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getTrace } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const trace = await getTrace(event.params.id);
	if (!trace) error(404, 'Trace not found');
	return { trace };
};
