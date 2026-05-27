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
});
