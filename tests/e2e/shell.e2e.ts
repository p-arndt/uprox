import { test, expect, type Page } from '@playwright/test';
import { ADMIN, collectPageErrors, signInAdmin, testDb } from './helpers';

/** The app shell: sidebar, account menu, the "Jump to…" palette and `/app?setup`. */

test.describe('app shell', () => {
	let errors: string[];

	test.beforeEach(async ({ page }) => {
		errors = collectPageErrors(page);
		await signInAdmin(page);
	});

	test.afterEach(() => {
		expect(errors, 'browser console errors').toEqual([]);
	});

	const accountMenu = (page: Page) =>
		page.getByRole('button', { name: `Account menu for ${ADMIN.name}` });

	test('the account menu toggles the theme and signs out with the sidebar collapsed', async ({
		page
	}) => {
		await page.goto('/app/services');
		await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
		const sidebar = page.locator('[data-slot="sidebar"][data-state]');
		await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
		// collapsed to icons: the name next to the avatar is gone, the menu is not
		await expect(accountMenu(page)).toBeVisible();

		const html = page.locator('html');
		const wasDark = ((await html.getAttribute('class')) ?? '').split(/\s+/).includes('dark');
		await accountMenu(page).click();
		await expect(page.getByRole('menu')).toContainText(ADMIN.email);
		await page.getByRole('menuitem', { name: 'Toggle theme' }).click();
		if (wasDark) await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
		else await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);

		await accountMenu(page).click();
		await page.getByRole('menuitem', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(/\/login$/);
		await page.goto('/app');
		await expect(page).toHaveURL(/\/login$/);
	});

	test('the palette opens with the keyboard shortcut and navigates', async ({ page }) => {
		await page.goto('/app/services');
		const palette = page.getByPlaceholder('Jump to a page…');
		// the shortcut hint renders on mount, so once it shows the keydown
		// listener is attached too
		await expect(page.getByRole('button', { name: 'Jump to a page' })).toContainText('K');

		for (const shortcut of ['Control+k', 'Meta+k']) {
			await page.keyboard.press(shortcut);
			await expect(palette).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(palette).toBeHidden();
		}

		// the header button opens it too
		await page.getByRole('button', { name: 'Jump to a page' }).click();
		await expect(palette).toBeVisible();
		await palette.fill('Audit');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/app\/audit$/);
		await expect(palette).toBeHidden();
		await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();

		await page.keyboard.press('Control+k');
		await page.getByRole('option', { name: 'Model Prices' }).click();
		await expect(page).toHaveURL(/\/app\/pricing$/);
	});

	test('the gateway nav follows the setup order', async ({ page }) => {
		const gateway = page
			.locator('[data-sidebar="group"]')
			.filter({ has: page.getByText('Gateway', { exact: true }) });
		await expect(gateway.getByRole('link')).toHaveText([
			'Providers',
			'Services',
			'Machine Tokens',
			'Connect'
		]);
	});

	test('/app?setup keeps the checklist reachable once traffic exists', async ({ page }) => {
		const sql = testDb();
		try {
			const [row] = await sql<{ count: number }[]>`
				select count(*)::int as count from audit_log where action like 'gateway.%'
			`;
			// far in the past, so no usage window (or its figures) sees it
			if (!row?.count) {
				await sql`
					insert into audit_log (action, status, provider, model, created_at)
					values ('gateway.chat', 'ok', 'openai', 'gpt-4o-mini', '2002-06-01T12:00:00Z')
				`;
			}
		} finally {
			await sql.end();
		}

		// with traffic, the front door is the cost analysis
		await page.goto('/app');
		await expect(page).toHaveURL(/\/app\/usage(\?|$)/);

		// asked for explicitly, the checklist stays put instead of redirecting
		await page.goto('/app?setup');
		await expect(page).toHaveURL(/\/app\?setup/);
		await expect(page.getByRole('heading', { name: 'Get started with uprox' })).toBeVisible();
		await expect(page.getByText('Make your first request')).toBeVisible();
		await expect(page.getByText(/\d of 3 steps done/)).toBeVisible();
	});
});
