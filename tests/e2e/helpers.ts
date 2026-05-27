import { expect, type Page } from '@playwright/test';

export interface TestUser {
	name: string;
	email: string;
	password: string;
}

/** A fresh, collision-proof account for one test. */
export function newUser(): TestUser {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return {
		name: 'Ada Lovelace',
		email: `e2e-${id}@example.com`,
		password: 'correct-horse-battery-staple'
	};
}

/**
 * Sign up via the login page and land on the dashboard. better-auth's
 * `autoSignIn` logs the new user straight in, so this returns an authenticated
 * page positioned at /app.
 */
export async function signUp(page: Page, user: TestUser = newUser()): Promise<TestUser> {
	await page.goto('/login');
	// flip from the default sign-in view to the sign-up form
	await page.getByRole('button', { name: 'Sign up' }).click();

	await page.getByLabel('Name').fill(user.name);
	await page.getByLabel('Email').fill(user.email);
	await page.getByLabel('Password').fill(user.password);
	await page.getByRole('button', { name: 'Create account' }).click();

	await page.waitForURL('**/app');
	// the sidebar nav link, exact so it doesn't collide with the overview's
	// "Services 0" summary card link
	await expect(page.getByRole('link', { name: 'Services', exact: true })).toBeVisible();
	return user;
}
