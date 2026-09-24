import { test, expect } from '@playwright/test';
import { ADMIN, APP_URL, newUser, signInAdmin } from './helpers';

test.describe('authentication', () => {
	test('the owner signs in and lands on the dashboard', async ({ page }) => {
		await signInAdmin(page);
		await expect(page).toHaveURL(APP_URL);
		// the signed-in user shows in the sidebar footer
		await expect(page.getByText(ADMIN.email)).toBeVisible();
	});

	test('redirects an unauthenticated visitor from /app to /login', async ({ page }) => {
		// make sure setup is done, otherwise every route funnels to /setup
		await signInAdmin(page);
		await page.context().clearCookies();

		await page.goto('/app');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
	});

	test('the setup wizard is closed once an account exists', async ({ page }) => {
		await signInAdmin(page);
		await page.context().clearCookies();

		await page.goto('/setup');
		await expect(page).toHaveURL(/\/login$/);
	});

	test('sign out returns to /login and re-guards the dashboard', async ({ page }) => {
		await signInAdmin(page);
		await page.getByRole('button', { name: /^Account menu/ }).click();
		await page.getByRole('menuitem', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(/\/login$/);

		// session is gone: the dashboard bounces back to login
		await page.goto('/app');
		await expect(page).toHaveURL(/\/login$/);
	});

	test('sign in with wrong credentials shows an error and stays on /login', async ({ page }) => {
		await signInAdmin(page);
		await page.context().clearCookies();

		const user = newUser();
		await page.goto('/login');
		await page.getByLabel('Email').fill(user.email); // never registered
		await page.getByLabel('Password').fill(user.password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.locator('p.text-destructive')).toBeVisible();
	});

	test('signed-in user visiting /login is redirected to the dashboard', async ({ page }) => {
		await signInAdmin(page);
		await page.goto('/login');
		await expect(page).toHaveURL(APP_URL);
	});

	// Regression: uprox is invite-only. The legitimate signup flows (setup wizard,
	// invite acceptance) call auth.api.signUpEmail server-side, which bypasses the
	// HTTP handle chain; the public better-auth endpoint must be closed so a
	// stranger can't self-register a (read-capable) member account.
	test('public sign-up endpoint is blocked (invite-only)', async ({ page, request }) => {
		await signInAdmin(page);

		const user = newUser();
		const res = await request.post('/api/auth/sign-up/email', {
			data: { name: user.name, email: user.email, password: user.password },
			headers: { 'content-type': 'application/json' },
			failOnStatusCode: false
		});
		expect(res.status()).toBe(403);

		// and the account must not have been created: signing in with it fails
		const signIn = await request.post('/api/auth/sign-in/email', {
			data: { email: user.email, password: user.password },
			headers: { 'content-type': 'application/json' },
			failOnStatusCode: false
		});
		expect(signIn.ok()).toBe(false);
	});
});
