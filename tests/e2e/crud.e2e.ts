import { test, expect } from '@playwright/test';
import { signUp } from './helpers';

/**
 * The core operator journey: configure an upstream provider key, create a
 * service (machine identity), then issue a machine token and see its one-time
 * secret. Each test runs as a fresh user so the dashboard always starts empty.
 */
test.describe('dashboard CRUD', () => {
	test('configures an OpenAI provider key', async ({ page }) => {
		await signUp(page);
		await page.getByRole('link', { name: 'Providers', exact: true }).click();
		await expect(page).toHaveURL(/\/app\/providers$/);

		// the OpenAI card starts unconfigured — open its "Add key" dialog
		const openaiCard = page
			.getByText('OpenAI', { exact: true })
			.locator('xpath=ancestor::div[.//button[normalize-space()="Add key"]][1]');
		await openaiCard.getByRole('button', { name: 'Add key' }).click();

		const keyDialog = page.getByRole('dialog', { name: 'OpenAI API key' });
		await expect(keyDialog).toBeVisible();
		// exact so it doesn't also match the dialog itself (labelled "OpenAI API key")
		await keyDialog.getByLabel('API key', { exact: true }).fill('sk-test-deadbeefdeadbeefdeadbeef');
		await keyDialog.getByRole('button', { name: 'Save key' }).click();

		// the card flips to a "configured" badge — exact, so it isn't satisfied by
		// the "No key configured" text on the still-empty provider cards
		await expect(page.getByText('configured', { exact: true })).toBeVisible();
	});

	test('creates a service', async ({ page }) => {
		await signUp(page);
		await page.getByRole('link', { name: 'Services', exact: true }).click();

		await page.getByRole('button', { name: 'New service' }).click();
		await page.getByLabel('Name').fill('support-agent');
		await page.getByRole('button', { name: 'Create service' }).click();

		await expect(page.getByRole('cell', { name: 'support-agent' })).toBeVisible();
	});

	test('issues a machine token and reveals the secret once', async ({ page }) => {
		await signUp(page);

		// a token needs a service to belong to
		await page.getByRole('link', { name: 'Services', exact: true }).click();
		await page.getByRole('button', { name: 'New service' }).click();
		await page.getByLabel('Name').fill('token-host');
		await page.getByRole('button', { name: 'Create service' }).click();
		await expect(page.getByRole('cell', { name: 'token-host' })).toBeVisible();

		await page.getByRole('link', { name: 'Machine Tokens', exact: true }).click();
		await page.getByRole('button', { name: 'New token' }).click();
		await page.getByLabel('Token name').fill('production');
		await page.getByRole('button', { name: 'Create token' }).click();

		// one-time secret reveal: a uprox_live_ plaintext, shown exactly once.
		// Address it by name — the create dialog is briefly still in the DOM as it
		// animates out, so a bare role=dialog would match two elements.
		const reveal = page.getByRole('dialog', { name: 'Token created' });
		await expect(reveal).toBeVisible();
		await expect(reveal.locator('code')).toContainText('uprox_live_');
		await reveal.getByRole('button', { name: 'Done' }).click();

		// the token now appears in the table as active, masked
		const row = page.getByRole('row', { name: /production/ });
		await expect(row).toContainText('active');
		await expect(row.getByText('uprox_live_', { exact: false })).toBeVisible();
	});

	test('a token cannot be issued before any service exists', async ({ page }) => {
		await signUp(page);
		await page.getByRole('link', { name: 'Machine Tokens', exact: true }).click();
		// the empty state nudges the operator to create a service first
		await expect(page.getByText('Create a service first')).toBeVisible();
		await expect(page.getByRole('button', { name: 'New token' })).toBeDisabled();
	});
});
