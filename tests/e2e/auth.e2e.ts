import { test, expect } from '@playwright/test';
import { newUser, signUp } from './helpers';

test.describe('authentication', () => {
	test('redirects an unauthenticated visitor from /app to /login', async ({ page }) => {
		await page.goto('/app');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
	});

	test('sign up creates an account and lands on the dashboard', async ({ page }) => {
		const user = await signUp(page);
		await expect(page).toHaveURL(/\/app$/);
		// the new user's personal organization shows in the sidebar footer
		await expect(page.getByText(user.email)).toBeVisible();
		await expect(page.getByText("Ada Lovelace's Org")).toBeVisible();
	});

	test('sign out returns to /login and re-guards the dashboard', async ({ page }) => {
		await signUp(page);
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(/\/login$/);

		// session is gone: the dashboard bounces back to login
		await page.goto('/app');
		await expect(page).toHaveURL(/\/login$/);
	});

	test('sign in with wrong credentials shows an error and stays on /login', async ({ page }) => {
		const user = newUser();
		await page.goto('/login');
		await page.getByLabel('Email').fill(user.email); // never registered
		await page.getByLabel('Password').fill(user.password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.locator('p.text-destructive')).toBeVisible();
	});

	test('signed-in user visiting /login is redirected to the dashboard', async ({ page }) => {
		await signUp(page);
		await page.goto('/login');
		await expect(page).toHaveURL(/\/app$/);
	});

	// Regression: uprox is invite-only. The legitimate signup flows (setup wizard,
	// invite acceptance) call auth.api.signUpEmail server-side, which bypasses the
	// HTTP handle chain; the public better-auth endpoint must be closed so a
	// stranger can't self-register a (read-capable) member account.
	test('public sign-up endpoint is blocked (invite-only)', async ({ request }) => {
		const user = newUser();
		const res = await request.post('/api/auth/sign-up/email', {
			data: { name: user.name, email: user.email, password: user.password },
			headers: { 'content-type': 'application/json' },
			failOnStatusCode: false
		});
		expect(res.status()).toBe(403);

		// and the account must not have been created — signing in with it fails
		await page_signInShouldFail(request, user.email, user.password);
	});
});

/** Assert credentials don't authenticate (account was never created). */
async function page_signInShouldFail(
	request: import('@playwright/test').APIRequestContext,
	email: string,
	password: string
) {
	const res = await request.post('/api/auth/sign-in/email', {
		data: { email, password },
		headers: { 'content-type': 'application/json' },
		failOnStatusCode: false
	});
	expect(res.ok()).toBe(false);
}
