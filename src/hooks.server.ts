import { building, dev } from '$app/environment';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { gatewayError } from '$lib/server/gateway';
import { seedDefaultModelPrices } from '$lib/server/pricing';
import { isSetupComplete } from '$lib/server/setup';
import { redirect, text, type Handle } from '@sveltejs/kit';
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
 * Gateway proxy surface — the API-shaped route prefixes. An unmatched path under
 * one of these is an API client hitting a missing/misspelled endpoint, so it
 * should get a machine-readable JSON error, not SvelteKit's HTML 404 page.
 */
const GATEWAY_PREFIXES = ['/v1/', '/openai/'];

/**
 * Same-origin CSRF guard for the cookie-authenticated dashboard.
 *
 * SvelteKit's built-in origin check is disabled in svelte.config.js
 * (`csrf.trustedOrigins: ['*']`) because the gateway surface (/v1, /openai) must
 * accept `multipart/form-data` uploads — e.g. audio transcription — from
 * server-to-server API clients that send no `Origin` header; the built-in guard
 * rejects those as "Cross-site … form submissions are forbidden". Those routes
 * are Bearer-authenticated and therefore not CSRF-vulnerable.
 *
 * This hook re-applies the identical same-origin check to every OTHER route, so
 * the cookie-authenticated SvelteKit form actions (/app/**, /setup, /invite/**)
 * keep exactly the CSRF protection SvelteKit gave them. Mirrors the built-in
 * behaviour: production-only, form content-types, unsafe methods.
 */
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isFormPost(request: Request): boolean {
	if (!CSRF_METHODS.has(request.method)) return false;
	const type = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
	return FORM_CONTENT_TYPES.includes(type);
}

const handleCsrf: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const isGateway = GATEWAY_PREFIXES.some((p) => url.pathname.startsWith(p));
	if (!dev && !isGateway && isFormPost(request) && request.headers.get('origin') !== url.origin) {
		return text(`Cross-site ${request.method} form submissions are forbidden`, { status: 403 });
	}
	return resolve(event);
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

/**
 * Block public self-registration to keep the product invite-only.
 *
 * better-auth exposes `POST /api/auth/sign-up/email` (under the `/api/auth/sign-up`
 * prefix) whenever email/password auth is enabled, and we deliberately do not set
 * `disableSignUp`. Left open, anyone could self-register a `member` account and read
 * sensitive dashboard data (captured traces, audit logs, usage).
 *
 * The legitimate email-signup flows (first admin in `/setup`, invited users in
 * `/invite/[id]`) call `auth.api.signUpEmail(...)` as a direct server function. Those
 * calls never traverse SvelteKit's `handle` hook, so blocking the incoming HTTP request
 * path here does NOT affect them. OIDC sign-in uses `/api/auth/oauth2/**` and
 * `/api/auth/callback/**`, which this guard leaves untouched.
 *
 * Must run BEFORE `handleBetterAuth` so the request is rejected before better-auth
 * processes it.
 */
const handleBlockPublicSignup: Handle = async ({ event, resolve }) => {
	if (event.request.method === 'POST' && event.url.pathname.startsWith('/api/auth/sign-up')) {
		return new Response(JSON.stringify({ error: 'Registration is invite-only.' }), {
			status: 403,
			headers: { 'content-type': 'application/json' }
		});
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

/**
 * One line per HTTP request: `[access] METHOD path -> status (ms)`. Skips
 * SvelteKit static assets and auth chatter so logs stay focused on the gateway
 * surface. Enable verbose mode with `ACCESS_LOG=verbose` to log everything.
 */
const handleAccessLog: Handle = async ({ event, resolve }) => {
	const start = Date.now();
	const response = await resolve(event);
	const path = event.url.pathname;
	const verbose = process.env.ACCESS_LOG === 'verbose';
	const skip =
		!verbose &&
		(path.startsWith('/_app/') ||
			path.startsWith('/@') ||
			path === '/favicon.ico' ||
			path.startsWith('/api/auth/'));
	if (!skip) {
		console.log(
			`[access] ${event.request.method} ${path} -> ${response.status} (${Date.now() - start}ms)`
		);
	}
	return response;
};

/**
 * Turn SvelteKit's generic HTML 404 into an OpenAI-style JSON error for the
 * gateway surface. SvelteKit answers an unmatched route with a 404 whose body is
 * the fallback error HTML; for `/v1/*` and `/openai/*` an SDK expects JSON, so we
 * replace it with the same error envelope the gateway uses for every other
 * failure. Routes that do exist return their own (non-404) responses untouched.
 */
const handleGatewayNotFound: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (response.status !== 404) return response;
	// A route that ran and returned its own JSON 404 (e.g. an upstream provider
	// 404 forwarded by proxyToProvider) is already machine-readable — only
	// SvelteKit's HTML fallback for an unmatched route should be rewritten.
	if ((response.headers.get('content-type') ?? '').includes('application/json')) return response;
	const path = event.url.pathname;
	if (!GATEWAY_PREFIXES.some((p) => path.startsWith(p))) return response;
	return gatewayError(
		404,
		`No such gateway route: ${event.request.method} ${path}. This uprox proxy does not implement this endpoint.`,
		'not_found_error'
	);
};

export const handle: Handle = sequence(
	handleAccessLog,
	handleCsrf,
	handleGatewayNotFound,
	handleSetup,
	handleBlockPublicSignup,
	handleBetterAuth
);
