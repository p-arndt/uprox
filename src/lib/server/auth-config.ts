import { env } from '$env/dynamic/private';

/**
 * Auth method configuration, driven entirely by environment variables.
 *
 * uprox supports two human sign-in methods:
 *   - email + password (built into better-auth)
 *   - a single OIDC provider (via better-auth's genericOAuth plugin)
 *
 * Both are configured here so the rest of the app has one place to ask
 * "which login methods are available?". Nothing here is stored in the DB —
 * changing auth methods is a deploy-time concern (set env vars + restart),
 * matching how the sentio reference does it.
 */

export interface OidcConfig {
	providerId: 'oidc';
	providerName: string;
	clientId: string;
	clientSecret: string;
	/** Issuer base URL; the discovery doc is derived from it. */
	issuer: string;
	discoveryUrl: string;
	scopes: string[];
}

/** Which sign-in methods the login UI should offer. */
export interface EnabledProviders {
	email: boolean;
	oidc: boolean;
}

/**
 * Email + password login. Enabled unless `EMAIL_AUTH_DISABLED=true`.
 *
 * Kept on by default even when OIDC is configured: invited members still
 * register with a password to accept their invitation, and the initial-setup
 * admin account is always created with one.
 */
export function isEmailAuthEnabled(): boolean {
	return env.EMAIL_AUTH_DISABLED !== 'true';
}

/**
 * Resolve OIDC settings from the environment. Returns null (OIDC disabled)
 * unless all three required vars are present, so a half-configured provider
 * never silently breaks login.
 */
export function getOidcConfig(): OidcConfig | null {
	const clientId = env.OIDC_CLIENT_ID?.trim();
	const clientSecret = env.OIDC_CLIENT_SECRET?.trim();
	const issuer = env.OIDC_ISSUER?.trim().replace(/\/+$/, '');

	if (!clientId || !clientSecret || !issuer) {
		if (clientId || clientSecret || issuer) {
			console.warn(
				'OIDC is partially configured — set OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_ISSUER together. OIDC login is disabled.'
			);
		}
		return null;
	}

	const scopes = env.OIDC_SCOPES?.trim()
		? env.OIDC_SCOPES.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: ['openid', 'email', 'profile'];

	return {
		providerId: 'oidc',
		providerName: env.OIDC_PROVIDER_NAME?.trim() || 'Single sign-on',
		clientId,
		clientSecret,
		issuer,
		discoveryUrl: `${issuer}/.well-known/openid-configuration`,
		scopes
	};
}

/** True when a usable OIDC provider is configured. */
export function isOidcEnabled(): boolean {
	return getOidcConfig() !== null;
}

/** The set of sign-in methods to surface in the UI. */
export function getEnabledProviders(): EnabledProviders {
	return {
		email: isEmailAuthEnabled(),
		oidc: isOidcEnabled()
	};
}
