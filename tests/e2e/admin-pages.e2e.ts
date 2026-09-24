import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin, uniqueSuffix } from './helpers';

/**
 * Smoke coverage for the admin pages that were split into components: each one
 * renders, its primary interaction works, and the browser logs no errors.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

/** Create a service and a token over the admin API, returning their ids. */
async function createServiceAndToken(page: Page) {
	const name = `smoke-${uniqueSuffix()}`;
	const svc = await page.request.post('/api/services', { data: { name } });
	expect(svc.status()).toBe(201);
	const service = (await svc.json()) as { id: string; name: string };

	const tok = await page.request.post('/api/tokens', {
		data: { name: `${name}-token`, serviceId: service.id }
	});
	expect(tok.status()).toBe(201);
	const token = (await tok.json()) as { id: string; name: string };
	return { service, token };
}

/** The shared cost-analysis command bar (range, group-by, filters, refresh). */
async function expectUsageToolbar(page: Page) {
	await expect(page.getByRole('button', { name: /Group by/ })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeVisible();
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
	await expect(page.getByText('This panel could not be loaded')).toHaveCount(0);
}

test.describe('admin pages', () => {
	test.beforeEach(async ({ page }) => {
		await signInAdmin(page);
	});

	test('members: lists the owner and opens the invite dialog', async ({ page }) => {
		await page.goto('/app/members');
		await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
		await expect(page.getByRole('cell', { name: /e2e-admin@example\.com/ }).first()).toBeVisible();

		await page.getByRole('button', { name: 'Invite member' }).click();
		const dialog = page.getByRole('dialog', { name: 'Invite a member' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel('Email')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('settings: a toggled switch persists across a reload', async ({ page }) => {
		await page.goto('/app/settings');
		await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
		for (const card of [
			'Response cache',
			'Member permissions',
			'Token security',
			'Instance budget',
			'Budget alerts'
		]) {
			await expect(page.getByText(card, { exact: true }).first()).toBeVisible();
		}

		const label = 'Allow re-copying new tokens by default';
		const card = page.locator('[data-slot="card"]').filter({ hasText: 'Token security' });
		const toggle = card.getByRole('switch', { name: label });
		const before = (await toggle.getAttribute('aria-checked')) === 'true';

		const save = async (expected: boolean) => {
			await toggle.click();
			await expect(toggle).toHaveAttribute('aria-checked', String(expected));
			await card.getByRole('button', { name: 'Save' }).click();
			await expect(page.getByText('Settings saved').first()).toBeVisible();
			await page.reload();
			await expect(toggle).toHaveAttribute('aria-checked', String(expected));
		};

		await save(!before);
		// restore, so the instance default stays what other tests expect
		await save(before);
	});

	test('policies: create and edit a preset', async ({ page }) => {
		const name = `preset-${uniqueSuffix()}`;
		await page.goto('/app/policies');
		await expect(page.getByRole('heading', { name: 'Presets' })).toBeVisible();

		await page.getByRole('button', { name: 'New preset' }).click();
		const create = page.getByRole('dialog', { name: 'Create preset' });
		await create.getByLabel('Name', { exact: true }).fill(name);
		await create.getByRole('button', { name: 'Create preset' }).click();
		await expect(create).toBeHidden();

		const card = page.locator('[data-slot="card"]').filter({ hasText: name });
		await expect(card).toBeVisible();
		await expect(card).toContainText('Rate: unlimited');
		await expect(card).toContainText('Not used yet');

		// a second preset with the same name (any case) is rejected inline
		await page.getByRole('button', { name: 'New preset' }).click();
		await create.getByLabel('Name', { exact: true }).fill(name.toUpperCase());
		await create.getByRole('button', { name: 'Create preset' }).click();
		await expect(create).toContainText('A preset with this name already exists');
		await page.keyboard.press('Escape');
		await expect(create).toBeHidden();

		await card.getByRole('button', { name: `Edit preset ${name}` }).click();
		const edit = page.getByRole('dialog', { name: 'Edit preset' });
		await expect(edit.getByLabel('Name', { exact: true })).toHaveValue(name);
		await edit.getByLabel('Rate limit (req/min)').fill('42');
		await edit.getByRole('button', { name: 'Save preset' }).click();
		await expect(edit).toBeHidden();

		await expect(card).toContainText('Rate: 42/min per token');
	});

	test('pricing: opens the add-model dialog', async ({ page }) => {
		await page.goto('/app/pricing');
		await expect(page.getByRole('heading', { name: 'Model Prices' })).toBeVisible();
		await expect(page.getByLabel('Search models')).toBeVisible();

		await page.getByRole('button', { name: 'Add model' }).click();
		const dialog = page.getByRole('dialog', { name: 'Add model price' });
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('providers: renders every provider card', async ({ page }) => {
		await page.goto('/app/providers');
		await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
		const openai = page
			.locator('[data-slot="card"]')
			.filter({ has: page.getByText('OpenAI', { exact: true }) });
		await expect(openai).toBeVisible();
		// the header's key count, not the "No key configured." body line
		await expect(openai.locator('[data-slot="card-description"]')).toContainText(
			/\d+\s+keys? configured/
		);
	});

	test('service and token detail pages show the usage toolbar', async ({ page }) => {
		const { service, token } = await createServiceAndToken(page);

		await page.goto(`/app/services/${service.id}`);
		await expect(page.getByRole('heading', { name: service.name })).toBeVisible();
		await expectUsageToolbar(page);

		await page.goto(`/app/tokens/${token.id}`);
		await expect(page.getByRole('heading', { name: token.name })).toBeVisible();
		await expectUsageToolbar(page);
		// the token header links back to its service
		// exact: the breadcrumb's "<service>-token" entry would match a prefix too
		await expect(page.getByRole('link', { name: service.name, exact: true })).toBeVisible();
	});
});

test.describe('auth chrome', () => {
	test('login page renders the shared auth shell', async ({ page }) => {
		// make sure setup is complete, so /login is not funnelled to /setup
		await signInAdmin(page);
		await page.context().clearCookies();

		await page.goto('/login');
		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
		await expect(page.getByLabel('Email')).toBeVisible();
		await expect(page.getByLabel('Password')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

		// once set up, the setup wizard hands over to the same login chrome
		await page.goto('/setup');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
	});
});
