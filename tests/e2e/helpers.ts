import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';

export interface TestUser {
	name: string;
	email: string;
	password: string;
}

/** A fresh, collision-proof identity (never registered anywhere). */
export function newUser(): TestUser {
	return {
		name: 'Ada Lovelace',
		email: `e2e-${uniqueSuffix()}@example.com`,
		password: 'correct-horse-battery-staple'
	};
}

/** Short unique suffix for entity names, so tests never collide on shared rows. */
export function uniqueSuffix(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The instance owner. uprox is invite-only: the first account is created once
 * through the /setup wizard, every later sign-in uses the login form. The test
 * database is recreated per run, so whichever test runs first bootstraps it.
 */
export const ADMIN: TestUser = {
	name: 'Ada Lovelace',
	email: 'e2e-admin@example.com',
	password: 'correct-horse-battery-staple'
};

/** The dashboard landing: /app, or a page it forwards to. */
export const APP_URL = /\/app(\/[^?]*)?(\?.*)?$/;

/**
 * Sign in as the instance owner and land on /app. Completes the one-time setup
 * wizard when the instance has no account yet.
 */
export async function signInAdmin(page: Page): Promise<TestUser> {
	await page.goto('/login');
	if (new URL(page.url()).pathname === '/setup') {
		await page.getByLabel('Name').fill(ADMIN.name);
		await page.getByLabel('Email').fill(ADMIN.email);
		await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
		await page.getByLabel('Confirm password').fill(ADMIN.password);
		await page.getByRole('button', { name: 'Create admin account' }).click();
	} else {
		await page.getByLabel('Email').fill(ADMIN.email);
		await page.getByLabel('Password').fill(ADMIN.password);
		await page.getByRole('button', { name: 'Sign in' }).click();
	}
	// /app forwards to the cost analysis page once the instance has traffic
	await page.waitForURL(APP_URL);
	// the sidebar nav link, exact so it doesn't collide with overview summary links
	await expect(page.getByRole('link', { name: 'Services', exact: true })).toBeVisible();
	return ADMIN;
}

/**
 * Collect browser console errors and uncaught page errors. Assert the returned
 * array is empty at the end of a test.
 */
export function collectPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
	});
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
	return errors;
}

let envLoaded = false;

/**
 * A direct connection to the e2e database (`uprox_test`), for seeding rows the
 * UI cannot create (gateway traffic). Credentials come from `.env`, like the
 * preview server's.
 */
export function testDb() {
	if (!envLoaded) {
		try {
			process.loadEnvFile('.env');
		} catch {
			// no .env: rely on the ambient environment (CI)
		}
		envLoaded = true;
	}
	return postgres({
		host: process.env.POSTGRES_HOST ?? 'localhost',
		port: Number(process.env.POSTGRES_PORT ?? 5432),
		user: process.env.POSTGRES_USER ?? 'uprox',
		password: process.env.POSTGRES_PASSWORD ?? 'uprox',
		database: process.env.E2E_DB ?? 'uprox_test',
		max: 1,
		onnotice: () => {}
	});
}
