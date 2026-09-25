import { test, expect } from '@playwright/test';
import { collectPageErrors, signInAdmin, testDb } from './helpers';

/**
 * Onboarding on an instance that has nothing configured yet. The file name
 * sorts first on purpose: the test database is recreated per run and specs run
 * serially in file order, so this is the only place that still sees an instance
 * without provider keys, tokens or traffic. Every later spec adds some.
 */

test.describe('fresh instance onboarding', () => {
	let errors: string[];

	test.beforeAll(async () => {
		const sql = testDb();
		try {
			const [state] = await sql<{ keys: number; tokens: number; requests: number }[]>`
				select
					(select count(*)::int from provider_secret) as keys,
					(select count(*)::int from machine_token where revoked_at is null) as tokens,
					(select count(*)::int from audit_log where action like 'gateway.%') as requests
			`;
			// a reused preview server (reuseExistingServer) keeps an old database
			expect(state, 'these tests need a freshly recreated test database').toEqual({
				keys: 0,
				tokens: 0,
				requests: 0
			});
		} finally {
			await sql.end();
		}
	});

	test.beforeEach(async ({ page }) => {
		errors = collectPageErrors(page);
		await signInAdmin(page);
	});

	test.afterEach(() => {
		expect(errors, 'browser console errors').toEqual([]);
	});

	test('/app shows the setup checklist with nothing done', async ({ page }) => {
		await page.goto('/app');
		await expect(page).toHaveURL(/\/app$/);
		await expect(page.getByRole('heading', { name: 'Get started with uprox' })).toBeVisible();
		await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
		await expect(page.getByText('0 of 3 steps done')).toBeVisible();

		for (const step of ['Connect a provider', 'Issue a machine token', 'Make your first request']) {
			await expect(page.getByText(step, { exact: true })).toBeVisible();
		}
		await page.getByRole('link', { name: 'Add key' }).click();
		await expect(page).toHaveURL(/\/app\/providers$/);
	});

	test('the cost analysis points a never-used gateway back to the checklist', async ({ page }) => {
		await page.goto('/app/usage');
		await page.getByRole('link', { name: /Nothing proxied yet/ }).click();
		await expect(page).toHaveURL(/\/app\?setup/);
		await expect(page.getByRole('heading', { name: 'Get started with uprox' })).toBeVisible();
	});

	test('connect lists the missing provider key and machine token', async ({ page }) => {
		await page.goto('/app/connect');
		const status = page.getByRole('status').filter({ hasText: 'Finish setup' });
		await expect(status).toContainText('Finish setup before these snippets work');
		await expect(status).toContainText('No provider key yet');
		await expect(status).toContainText('No machine token yet');

		await status.getByRole('link', { name: 'Create one' }).click();
		await expect(page).toHaveURL(/\/app\/tokens$/);
	});
});
