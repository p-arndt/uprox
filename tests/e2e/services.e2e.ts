import { test, expect } from '@playwright/test';
import { collectPageErrors, signInAdmin, uniqueSuffix } from './helpers';
import {
	acknowledgeSecret,
	apiCreateService,
	apiCreateToken,
	apiRevokeToken,
	rowWithLink
} from './token-helpers';

/**
 * Services: unique names, the detail page's token list and its "Issue token"
 * shortcut into the token create dialog.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
	await signInAdmin(page);
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

test.describe('services', () => {
	test('the create dialog rejects a duplicate name regardless of case', async ({ page }) => {
		const name = `dup-svc-${uniqueSuffix()}`;
		await apiCreateService(page, name);

		await page.goto('/app/services');
		await page.getByRole('button', { name: 'New service' }).click();
		const dialog = page.getByRole('dialog', { name: 'Create service' });
		await dialog.getByLabel('Name', { exact: true }).fill(name.toUpperCase());
		await dialog.getByRole('button', { name: 'Create service' }).click();

		await expect(dialog.getByText('A service with this name already exists')).toBeVisible();
		await expect(dialog).toBeVisible();
		await expect(page.getByRole('link', { name: name.toUpperCase(), exact: true })).toHaveCount(0);
	});

	test('"Issue token" preselects the service and the new token is listed', async ({ page }) => {
		const service = await apiCreateService(page, `issue-svc-${uniqueSuffix()}`);
		const tokenName = `issued-${uniqueSuffix()}`;

		await page.goto(`/app/services/${service.id}`);
		await expect(page.getByRole('heading', { name: service.name })).toBeVisible();
		await expect(page.getByText('No tokens have been issued to this service yet.')).toBeVisible();
		// the card header and the empty state both offer it
		await page.getByRole('link', { name: 'Issue token' }).first().click();

		const dialog = page.getByRole('dialog', { name: 'Create machine token' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel('Service', { exact: true })).toHaveText(service.name);
		// the one-shot ?service= param is dropped so a reload doesn't reopen the dialog
		await expect(page).toHaveURL(/\/app\/tokens$/);

		await dialog.getByLabel('Token name').fill(tokenName);
		await dialog.getByRole('button', { name: 'Create token' }).click();
		await acknowledgeSecret(page);
		await expect(rowWithLink(page, tokenName)).toContainText(service.name);

		await page.goto(`/app/services/${service.id}`);
		const row = rowWithLink(page, tokenName);
		await expect(row).toContainText('active');
		await expect(page.getByText('1 active of 1 issued to this service.')).toBeVisible();
	});

	test('inactive tokens hide behind a toggle and are left out of the active count', async ({
		page
	}) => {
		const service = await apiCreateService(page, `inactive-svc-${uniqueSuffix()}`);
		const live = await apiCreateToken(page, {
			name: `live-${uniqueSuffix()}`,
			serviceId: service.id
		});
		const dead = await apiCreateToken(page, {
			name: `dead-${uniqueSuffix()}`,
			serviceId: service.id
		});
		await apiRevokeToken(page, dead.id);

		await page.goto(`/app/services/${service.id}`);
		await expect(page.getByText('1 active of 2 issued to this service.')).toBeVisible();
		await expect(rowWithLink(page, live.name)).toBeVisible();
		await expect(page.getByRole('link', { name: dead.name, exact: true })).toHaveCount(0);

		const toggle = page.getByRole('button', { name: 'Show 1 inactive (revoked or expired)' });
		await toggle.click();
		await expect(rowWithLink(page, dead.name)).toContainText('revoked');
		await page.getByRole('button', { name: 'Hide inactive' }).click();
		await expect(page.getByRole('link', { name: dead.name, exact: true })).toHaveCount(0);

		await page.goto('/app/services');
		// Name, Type, Preset, Active tokens, Created, actions
		await expect(rowWithLink(page, service.name).getByRole('cell').nth(3)).toHaveText('1');
	});
});
