import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { getOrgSettings } from '$lib/server/data';
import { db } from '$lib/server/db';
import { organization, member } from '$lib/server/db/schema';

export const load: LayoutServerLoad = async (event) => {
	const ctx = await requireOrg(event);

	const [[org], memberships, settings] = await Promise.all([
		db
			.select({ id: organization.id, name: organization.name, slug: organization.slug })
			.from(organization)
			.where(eq(organization.id, ctx.organizationId))
			.limit(1),
		// every org the user belongs to — powers the sidebar org switcher
		db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				role: member.role
			})
			.from(member)
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(eq(member.userId, ctx.userId)),
		getOrgSettings(ctx.organizationId)
	]);

	return {
		user: { name: event.locals.user!.name, email: event.locals.user!.email },
		org,
		role: ctx.role,
		memberships,
		// member-permission toggles, so pages can show/hide controls via `can()`
		memberPermissions: {
			membersCanManageTokens: settings.membersCanManageTokens,
			membersCanManageServices: settings.membersCanManageServices
		}
	};
};
