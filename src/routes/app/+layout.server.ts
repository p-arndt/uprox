import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getOrgSettings } from '$lib/server/data';
import { db } from '$lib/server/db';
import { organization } from '$lib/server/db/schema';

export const load: LayoutServerLoad = async (event) => {
	const ctx = await requireOrg(event);

	const [[org], settings] = await Promise.all([
		db
			.select({ id: organization.id, name: organization.name, slug: organization.slug })
			.from(organization)
			.where(eq(organization.id, ctx.organizationId))
			.limit(1),
		getOrgSettings(ctx.organizationId)
	]);

	return {
		user: { name: event.locals.user!.name, email: event.locals.user!.email },
		org,
		role: ctx.role,
		// member-permission toggles, so pages can show/hide controls via `can()`
		memberPermissions: {
			membersCanManageTokens: settings.membersCanManageTokens,
			membersCanManageServices: settings.membersCanManageServices
		}
	};
};
