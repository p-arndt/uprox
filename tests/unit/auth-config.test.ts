import { describe, expect, it } from 'vitest';
import { mayCreateAccount, oauthErrorMessage, safeRedirect } from '$lib/server/auth-config';

describe('safeRedirect', () => {
	it('keeps internal single-slash paths', () => {
		expect(safeRedirect('/app/usage?range=7d')).toBe('/app/usage?range=7d');
	});

	it('falls back to /app for missing, external or protocol-relative targets', () => {
		expect(safeRedirect(null)).toBe('/app');
		expect(safeRedirect(undefined)).toBe('/app');
		expect(safeRedirect('')).toBe('/app');
		expect(safeRedirect('https://evil.example')).toBe('/app');
		expect(safeRedirect('//evil.example')).toBe('/app');
	});
});

describe('mayCreateAccount', () => {
	const closed = { ssoSignupEnabled: false, isFirstAccount: false, isInvited: false };

	it('allows anyone while SSO sign-up is enabled', () => {
		expect(mayCreateAccount({ ...closed, ssoSignupEnabled: true })).toBe(true);
	});

	it('rejects uninvited users once SSO sign-up is disabled', () => {
		expect(mayCreateAccount(closed)).toBe(false);
	});

	it('still lets the bootstrap account and invited users in', () => {
		expect(mayCreateAccount({ ...closed, isFirstAccount: true })).toBe(true);
		expect(mayCreateAccount({ ...closed, isInvited: true })).toBe(true);
	});
});

describe('oauthErrorMessage', () => {
	it('explains a disabled sign-up and falls back to a generic message', () => {
		expect(oauthErrorMessage(null)).toBeNull();
		expect(oauthErrorMessage('signup_disabled')).toContain('invite');
		expect(oauthErrorMessage('oauth_code_verification_failed')).toBe(
			'SSO sign-in failed. Please try again.'
		);
	});
});
