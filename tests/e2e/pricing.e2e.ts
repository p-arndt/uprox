import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin, uniqueSuffix } from './helpers';
import { toast } from './admin-helpers';

/**
 * Custom model prices on /app/pricing: add one through the dialog, edit it
 * inline in its row, see a failed inline save keep the row editable, remove it.
 * Model ids are stored lowercased, so the test names are lowercase too.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
	await signInAdmin(page);
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

/** The table row of one model, after narrowing the table to it. */
async function priceRow(page: Page, model: string) {
	await page.getByLabel('Search models').fill(model);
	return page
		.getByRole('row')
		.filter({ has: page.getByRole('cell', { name: model, exact: true }) });
}

test('adds a custom price, edits it inline and removes it', async ({ page }) => {
	const model = `e2e-model-${uniqueSuffix()}`;
	await page.goto('/app/pricing');

	await page.getByRole('button', { name: 'Add model' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add model price' });
	await dialog.getByLabel('Model', { exact: true }).fill(model);
	await dialog.locator('input[name="inputPerMtok"]').fill('1.5');
	await dialog.locator('input[name="outputPerMtok"]').fill('6');
	await dialog.getByRole('button', { name: 'Add model' }).click();
	await expect(dialog).toBeHidden();
	await expect(toast(page, 'Model price added')).toBeVisible();

	const row = await priceRow(page, model);
	await expect(row).toContainText('$1.50');
	await expect(row).toContainText('$6.00');
	await expect(row).toContainText('custom');

	await row.getByRole('button', { name: `Edit price for ${model}` }).click();
	const input = row.getByLabel('Input price per 1M tokens');
	await expect(input).toHaveValue('1.5');
	await input.fill('2.25');
	await row.getByRole('button', { name: `Save price for ${model}` }).click();
	await expect(toast(page, `Saved price for ${model}`)).toBeVisible();
	await expect(input).toBeHidden();
	await expect(row).toContainText('$2.25');

	// the new price is stored, not just shown
	await page.reload();
	const reloaded = await priceRow(page, model);
	await expect(reloaded).toContainText('$2.25');

	await reloaded.getByRole('button', { name: `Remove price for ${model}` }).click();
	const confirm = page.getByRole('alertdialog', { name: 'Remove this price?' });
	await confirm.getByRole('button', { name: 'Remove' }).click();
	await expect(confirm).toBeHidden();
	await expect(toast(page, 'Custom price removed')).toBeVisible();
	await expect(reloaded).toHaveCount(0);
	await expect(page.getByText(`No models match “${model}”.`)).toBeVisible();
});

test('a failing inline save shows an error toast and stays in edit mode', async ({ page }) => {
	const model = `e2e-gone-${uniqueSuffix()}`;
	const created = await page.request.post('/api/pricing', {
		data: { model, inputPerMtok: 1, outputPerMtok: 2 }
	});
	expect(created.status()).toBe(201);
	const { id } = (await created.json()) as { id: string };

	await page.goto('/app/pricing');
	const row = await priceRow(page, model);
	await row.getByRole('button', { name: `Edit price for ${model}` }).click();
	const input = row.getByLabel('Input price per 1M tokens');
	await input.fill('3');

	// someone else removes the price while this row is being edited
	const removed = await page.request.delete(`/api/pricing/${id}`);
	expect(removed.status()).toBe(204);

	await row.getByRole('button', { name: `Save price for ${model}` }).click();
	await expect(toast(page, 'Not found')).toBeVisible();
	// the draft survives, so nothing typed is lost
	await expect(input).toBeVisible();
	await expect(input).toHaveValue('3');
	await expect(row.getByRole('button', { name: `Save price for ${model}` })).toBeEnabled();

	await row.getByRole('button', { name: `Cancel editing ${model}` }).click();
	await expect(input).toBeHidden();
});
