import { test, expect } from '@playwright/test';
import { signInAdmin, uniqueSuffix } from './helpers';
import { MOCK_ENDPOINT, MOCK_PASSWORD, MOCK_PORT, MOCK_USERNAME } from './mock-upstream';

/**
 * The core operator journey: configure an upstream provider key (against the
 * local mock upstream, see mock-upstream.ts), create a
 * service (machine identity), then issue a machine token and see its one-time
 * secret. All tests share the one instance owner, so every created entity gets a
 * unique name.
 */
test.describe('dashboard CRUD', () => {
	test('configures a provider endpoint, verified against the upstream', async ({ page }) => {
		await signInAdmin(page);
		await page.getByRole('link', { name: 'Providers', exact: true }).click();
		await expect(page).toHaveURL(/\/app\/providers$/);

		// Ollama sits in the "Add a provider" grid until it has a key, and in its own
		// card afterwards; both expose the same "Add Ollama endpoint" button name
		await page.getByRole('button', { name: 'Add Ollama endpoint', exact: true }).click();

		const keyDialog = page.getByRole('dialog', { name: 'Add Ollama endpoint' });
		await expect(keyDialog).toBeVisible();
		await keyDialog.getByLabel('Endpoint URL').fill(MOCK_ENDPOINT);
		await keyDialog.getByLabel('Username').fill(MOCK_USERNAME);
		await keyDialog.getByLabel('Password').fill(MOCK_PASSWORD);
		await keyDialog.getByRole('button', { name: 'Save endpoint' }).click();

		// the mock accepts the credential, so the key saves without a detour
		await expect(page.getByText('Connection verified, saved')).toBeVisible();
		await expect(keyDialog).toBeHidden();
		const card = page
			.locator('[data-slot="card"]')
			.filter({ has: page.getByText('Ollama', { exact: true }) });
		// a regex is matched against the raw text, so allow the template's line break
		await expect(card).toContainText(/[1-9]\d*\s+keys?\s+configured/);
		await expect(card.getByText('••••beef').first()).toBeVisible();
		await expect(card.getByText(`127.0.0.1:${MOCK_PORT}`).first()).toBeVisible();
	});

	test('a rejected credential can be saved anyway and fails its test', async ({ page }) => {
		const label = `bad-key-${uniqueSuffix()}`;
		await signInAdmin(page);
		await page.goto('/app/providers');

		await page.getByRole('button', { name: 'Add Ollama endpoint', exact: true }).click();
		const keyDialog = page.getByRole('dialog', { name: 'Add Ollama endpoint' });
		await keyDialog.getByLabel('Endpoint URL').fill(MOCK_ENDPOINT);
		await keyDialog.getByLabel('Username').fill(MOCK_USERNAME);
		await keyDialog.getByLabel('Password').fill('wrong-password');
		// label and priority sit behind "Advanced" only for a provider's first key
		const labelField = keyDialog.getByLabel('Label');
		if (!(await labelField.isVisible())) await keyDialog.getByText('Advanced').click();
		await labelField.fill(label);
		await keyDialog.getByRole('button', { name: 'Save endpoint' }).click();

		// the mock answers 401 with an OpenAI-shaped error, which the dialog relays
		await expect(keyDialog).toContainText(
			'Upstream returned 401 Unauthorized: Incorrect API key provided'
		);
		const saveAnyway = keyDialog.getByRole('button', { name: 'Save anyway' });
		await expect(saveAnyway).toBeVisible();
		await saveAnyway.click();
		await expect(keyDialog).toBeHidden();
		await expect(page.getByText('Saved', { exact: true })).toBeVisible();

		// the stored key still fails an on-demand test
		const row = page
			.locator('div.rounded-lg.border')
			.filter({ hasText: label })
			.filter({ has: page.getByRole('button', { name: 'Test' }) });
		await row.getByRole('button', { name: 'Test' }).click();
		await expect(row.getByText('Test failed')).toBeVisible();

		// remove it again so it can never become some service's default key
		await row.getByRole('button', { name: 'Remove key' }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Remove key' }).click();
		await expect(page.getByText(label)).toHaveCount(0);
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
