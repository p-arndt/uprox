import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { genericOAuth } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	getOidcConfig,
	isEmailAuthEnabled,
	mayCreateAccount,
	SIGNUP_DISABLED_MESSAGE
} from '$lib/server/auth-config';
import { getSettings } from '$lib/server/settings';
import { hasValidInvitation } from '$lib/server/members';
import {
	user as authUser,
	session as authSession,
	account as authAccount,
	verification as authVerification
} from '$lib/server/db/auth.schema';

// Optional single OIDC provider, configured via env (see auth-config.ts).
const oidcConfig = getOidcConfig();

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	// Let Postgres generate ids (uuid defaultRandom) instead of better-auth's
	// string ids, so every table uses a native uuid primary key.
	advanced: {
		database: {
			generateId: false
		}
	},
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: {
			user: authUser,
			session: authSession,
			account: authAccount,
			verification: authVerification
		}
	}),
	emailAndPassword: { enabled: isEmailAuthEnabled(), autoSignIn: true },
	databaseHooks: {
		user: {
			create: {
				// Enforce the "SSO sign-up" setting. Throwing aborts the OAuth callback,
				// which redirects to its errorCallbackURL with ?error=signup_disabled.
				before: async (newUser) => {
					const { ssoSignupEnabled } = await getSettings();
					if (ssoSignupEnabled) return;
					const [existing] = await db.select({ id: authUser.id }).from(authUser).limit(1);
					const allowed = mayCreateAccount({
						ssoSignupEnabled,
						isFirstAccount: !existing,
						isInvited: await hasValidInvitation(newUser.email)
					});
					if (!allowed) throw new APIError('FORBIDDEN', { message: SIGNUP_DISABLED_MESSAGE });
				},
				// The whole self-hosted instance is a single workspace. The first
				// account to be created bootstraps it and becomes the owner; everyone
				// after keeps the column default ('member'). Invited users have their
				// role set by invitation acceptance (see /invite/[id]), so there is
				// nothing to do here for them.
				after: async (createdUser) => {
					if (!createdUser?.id) return;
					const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(authUser);
					// This newly-created user is the only one → make them the owner.
					if (Number(row?.count) === 1) {
						await db.update(authUser).set({ role: 'owner' }).where(eq(authUser.id, createdUser.id));
					}
				}
			}
		}
	},
	plugins: [
		// A single OIDC provider, only registered when fully configured. Users
		// signing in this way are auto-provisioned as instance members unless the
		// ssoSignupEnabled setting is off (the first one becomes the owner via the
		// user.create hook above).
		...(oidcConfig
			? [
					genericOAuth({
						config: [
							{
								providerId: oidcConfig.providerId,
								clientId: oidcConfig.clientId,
								clientSecret: oidcConfig.clientSecret,
								discoveryUrl: oidcConfig.discoveryUrl,
								scopes: oidcConfig.scopes,
								pkce: true
							}
						]
					})
				]
			: []),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
