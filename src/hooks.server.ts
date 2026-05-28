import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { seedDefaultModelPrices } from '$lib/server/pricing';
import { isSetupComplete } from '$lib/server/setup';
import { redirect, type Handle } from '@sveltejs/kit';
import { type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export const init: ServerInit = async () => {
	try {
		await db.execute(`SELECT NOW()`);
		console.log('Database connected successfully');
	} catch (error) {
		console.error('Failed to connect to database:', error);
		throw error;
	}

	await migrate(db, { migrationsFolder: 'drizzle' });
	console.log('Migrations completed successfully');

	// Platform-default model prices live in code, not in a migration. Idempotent.
	await seedDefaultModelPrices();
	console.log('Default model prices seeded');
};

/**
 * Gate the whole app behind one-time setup. Until the first admin account
 * exists, every request is funnelled to `/setup`; once it does, `/setup`
 * itself is closed off so the wizard can't be replayed.
 *
 * `/api/auth/**` is exempted during bootstrap so the OIDC sign-in flow can
 * complete (start on `/setup`, hop to the IdP, land on better-auth's
 * callback) — otherwise the callback would be hijacked back to `/setup`.
 */
const handleSetup: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const onSetup = path === '/setup';
	const isAuthApi = path.startsWith('/api/auth/');
	if (await isSetupComplete()) {
		if (onSetup) redirect(302, '/login');
	} else if (!onSetup && !isAuthApi) {
		redirect(302, '/setup');
	}
	return resolve(event);
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(handleSetup, handleBetterAuth);
