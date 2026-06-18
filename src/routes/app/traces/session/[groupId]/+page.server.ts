import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getTraceGroupDetail } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const calls = await getTraceGroupDetail(event.params.groupId);
	if (calls.length === 0) error(404, 'Session not found');
	return { groupId: event.params.groupId, calls };
};
