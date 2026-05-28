import type { LayoutServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getSettings } from '$lib/server/data';

export const load: LayoutServerLoad = async (event) => {
	const ctx = await requireOrg(event);
	const settings = await getSettings();

	return {
		user: { name: event.locals.user!.name, email: event.locals.user!.email },
		role: ctx.role,
		// member-permission toggles, so pages can show/hide controls via `can()`
		memberPermissions: {
			membersCanManageTokens: settings.membersCanManageTokens,
			membersCanManageServices: settings.membersCanManageServices
		}
	};
};
