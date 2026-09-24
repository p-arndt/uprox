import { test, expect } from '@playwright/test';
import { signInAdmin, uniqueSuffix } from './helpers';

/**
 * The core operator journey: configure an upstream provider key, create a
 * service (machine identity), then issue a machine token and see its one-time
 * secret. All tests share the one instance owner, so every created entity gets a
 * unique name.
 */
test.describe('dashboard CRUD', () => {
	test('configures an OpenAI provider key', async ({ page }) => {
		await signInAdmin(page);
		await page.getByRole('link', { name: 'Providers', exact: true }).click();
		await expect(page).toHaveURL(/\/app\/providers$/);

		// OpenAI sits in the "Add a provider" grid until it has a key, and in its own
		// card afterwards; both expose the same "Add OpenAI key" button name
		await page.getByRole('button', { name: 'Add OpenAI key', exact: true }).click();

		const keyDialog = page.getByRole('dialog', { name: 'Add OpenAI key' });
		await expect(keyDialog).toBeVisible();
		await keyDialog.getByLabel('API key', { exact: true }).fill('sk-test-deadbeefdeadbeefdeadbeef');
		await keyDialog.getByRole('button', { name: 'Save key' }).click();

		// the fake key fails the connection test (401 upstream, or no network in CI),
		// so the dialog offers to save it regardless
		const saveAnyway = keyDialog.getByRole('button', { name: 'Save anyway' });
		await expect(saveAnyway).toBeVisible({ timeout: 15_000 });
		await saveAnyway.click();

		await expect(keyDialog).toBeHidden();
		const openaiCard = page
			.locator('[data-slot="card"]')
			.filter({ has: page.getByText('OpenAI', { exact: true }) });
		// a regex is matched against the raw text, so allow the template's line break
		await expect(openaiCard).toContainText(/[1-9]\d*\s+keys?\s+configured/);
		await expect(openaiCard.getByText('••••beef')).toBeVisible();
	});

	test('creates a service', async ({ page }) => {
		const name = `support-agent-${uniqueSuffix()}`;
		await signInAdmin(page);
		await page.getByRole('link', { name: 'Services', exact: true }).click();

		await page.getByRole('button', { name: 'New service' }).click();
		await page.getByLabel('Name').fill(name);
		await page.getByRole('button', { name: 'Create service' }).click();

		// the name cell holds a link to the service; the actions cell's buttons are
		// labelled "Edit <name>" / "Delete <name>", so match the link exactly
		await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
	});

	test('issues a machine token and reveals the secret once', async ({ page }) => {
		const tokenName = `production-${uniqueSuffix()}`;
		await signInAdmin(page);

		await page.getByRole('link', { name: 'Machine Tokens', exact: true }).click();
		await page.getByRole('button', { name: 'New token' }).click();
		await page.getByLabel('Token name').fill(tokenName);
		await page.getByRole('button', { name: 'Create token' }).click();

		// one-time secret reveal: a uprox_live_ plaintext, shown exactly once.
		// Address it by name: the create dialog is briefly still in the DOM as it
		// animates out, so a bare role=dialog would match two elements.
		const reveal = page.getByRole('dialog', { name: 'Token created' });
		await expect(reveal).toBeVisible();
		// the dialog also shows a curl example in a second <code> block
		await expect(reveal.getByText(/^uprox_live_/)).toBeVisible();
		await reveal.getByRole('button', { name: "I've copied it" }).click();

		// the token now appears in the table as active, masked
		const row = page.getByRole('row', { name: new RegExp(tokenName) });
		await expect(row).toContainText('active');
		await expect(row.getByText('uprox_live_', { exact: false })).toBeVisible();
	});
});
