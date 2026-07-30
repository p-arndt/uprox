import type { LayoutServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getSettings } from '$lib/server/data';
// The running build's version, straight from the manifest that `pnpm version`
// bumps — so it can never drift from a hand-maintained copy. Imported in a
// server load, so the rest of package.json (scripts, dependency list) is read at
// build time and never shipped to the browser.
import { version } from '../../../package.json';

export const load: LayoutServerLoad = async (event) => {
	const ctx = await requireOrg(event);
	const settings = await getSettings();

	return {
		version,
		user: { name: event.locals.user!.name, email: event.locals.user!.email },
		role: ctx.role,
		// member-permission toggles, so pages can show/hide controls via `can()`
		memberPermissions: {
			membersCanManageTokens: settings.membersCanManageTokens,
			membersCanManageServices: settings.membersCanManageServices
		}
	};
};
