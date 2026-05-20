import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { requireOrg } from '$lib/server/org';
import { db } from '$lib/server/db';
import { organization } from '$lib/server/db/schema';

export const load: LayoutServerLoad = async (event) => {
	const ctx = await requireOrg(event);
	const [org] = await db
		.select({ id: organization.id, name: organization.name, slug: organization.slug })
		.from(organization)
		.where(eq(organization.id, ctx.organizationId))
		.limit(1);

	return {
		user: { name: event.locals.user!.name, email: event.locals.user!.email },
		org,
		role: ctx.role
	};
};
