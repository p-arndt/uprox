import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { organization } from 'better-auth/plugins';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { member, organization as organizationTable } from '$lib/server/db/auth.schema';

/** Make a url-safe, reasonably unique slug from a seed. */
function slugify(seed: string): string {
	const base = seed
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 24);
	return `${base || 'org'}-${crypto.randomUUID().slice(0, 8)}`;
}

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true, autoSignIn: true },
	databaseHooks: {
		user: {
			create: {
				// Every user gets a personal organization so the dashboard always
				// has an active org to work within.
				after: async (createdUser) => {
					const orgName = createdUser.name ? `${createdUser.name}'s Org` : 'Personal';
					const [org] = await db
						.insert(organizationTable)
						.values({
							id: crypto.randomUUID(),
							name: orgName,
							slug: slugify(createdUser.email.split('@')[0] ?? createdUser.name),
							createdAt: new Date()
						})
						.returning();

					await db.insert(member).values({
						id: crypto.randomUUID(),
						organizationId: org.id,
						userId: createdUser.id,
						role: 'owner',
						createdAt: new Date()
					});
				}
			}
		},
		session: {
			create: {
				// Pin the user's first organization as active for the new session.
				before: async (session) => {
					const [m] = await db
						.select({ organizationId: member.organizationId })
						.from(member)
						.where(eq(member.userId, session.userId))
						.limit(1);
					return { data: { ...session, activeOrganizationId: m?.organizationId ?? null } };
				}
			}
		}
	},
	plugins: [
		organization(),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
