import { test, expect } from '@playwright/test';
import { collectPageErrors, signInAdmin, uniqueSuffix } from './helpers';
import { cardWith, pickOption, toast } from './admin-helpers';

/**
 * The preset lifecycle on /app/policies: create one with limits and a model
 * allowlist, attach it to a service (UI) and a token (API), see the usage count,
 * delete it and check that the service is left without a preset.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
	await signInAdmin(page);
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

test('creates a preset with limits and an allowlist via the chip input', async ({ page }) => {
	const name = `preset-chips-${uniqueSuffix()}`;
	await page.goto('/app/policies');
	await page.getByRole('button', { name: 'New preset' }).click();
	const dialog = page.getByRole('dialog', { name: 'Create preset' });

	await dialog.getByLabel('Name', { exact: true }).fill(name);
	await dialog.getByLabel('Rate limit (req/min)').fill('30');
	await dialog.getByLabel('Daily').fill('5');
	await dialog.getByLabel('Monthly').fill('50');

	const models = dialog.getByRole('combobox', { name: 'Allowed models' });
	const suggestions = dialog.getByRole('listbox');
	const suggestion = suggestions.getByRole('option', { name: 'gpt-4o', exact: true });

	// known model ids from the price list are offered while typing
	await models.fill('gpt-4');
	await expect(suggestion).toBeVisible();
	await expect(suggestions.getByRole('option')).not.toHaveCount(0);
	await suggestion.click();
	await expect(dialog.getByRole('button', { name: 'Remove gpt-4o' })).toBeVisible();
	await expect(models).toHaveValue('');

	// a chosen model is no longer offered
	await models.fill('gpt-4');
	await expect(suggestions.getByRole('option').first()).toBeVisible();
	await expect(suggestion).toHaveCount(0);
	await models.fill('');

	// "*" only works as a trailing prefix glob, so an inner one is flagged at once
	const innerStar = '“gpt-*-mini”: * is only allowed at the end (prefix match)';
	await models.fill('gpt-*-mini');
	await models.press('Enter');
	await expect(dialog.getByText(innerStar).first()).toBeVisible();

	// ...and the server refuses it too, keeping the dialog open
	await dialog.getByRole('button', { name: 'Create preset' }).click();
	await expect(dialog.getByText(innerStar)).toHaveCount(2);
	await expect(dialog).toBeVisible();
	await expect(cardWith(page, name)).toHaveCount(0);

	await dialog.getByRole('button', { name: 'Remove gpt-*-mini' }).click();
	// only the server's message from the last submit is left
	await expect(dialog.getByText(innerStar)).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Create preset' }).click();
	await expect(dialog).toBeHidden();
	await expect(toast(page, 'Preset created')).toBeVisible();

	const card = cardWith(page, name);
	await expect(card).toContainText('gpt-4o');
	await expect(card).not.toContainText('gpt-*-mini');
	await expect(card).toContainText('Rate: 30/min per token');
	await expect(card).toContainText('Budget: $5/day · $50/mo');
	await expect(card).toContainText('Not used yet');

	// the same name again is rejected inside the dialog
	await page.getByRole('button', { name: 'New preset' }).click();
	await dialog.getByLabel('Name', { exact: true }).fill(name);
	await dialog.getByRole('button', { name: 'Create preset' }).click();
	await expect(dialog).toContainText('A preset with this name already exists');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(cardWith(page, name)).toHaveCount(1);
});

test('a preset in use shows its usage, and deleting it detaches the service', async ({ page }) => {
	const suffix = uniqueSuffix();
	const presetName = `preset-used-${suffix}`;
	const serviceName = `preset-svc-${suffix}`;

	const created = await page.request.post('/api/policies', { data: { name: presetName } });
	expect(created.status()).toBe(201);
	const preset = (await created.json()) as { id: string };

	// attach it to a new service through the services page form
	await page.goto('/app/services');
	await page.getByRole('button', { name: 'New service' }).click();
	const svcDialog = page.getByRole('dialog', { name: 'Create service' });
	await svcDialog.getByLabel('Name', { exact: true }).fill(serviceName);
	await pickOption(page, svcDialog.getByLabel('Preset', { exact: true }), presetName);
	await svcDialog.getByRole('button', { name: 'Create service' }).click();
	await expect(svcDialog).toBeHidden();

	const serviceRow = page
		.getByRole('row')
		.filter({ has: page.getByRole('link', { name: serviceName, exact: true }) });
	await expect(serviceRow.getByRole('link', { name: presetName, exact: true })).toBeVisible();

	// and to a token, over the API
	const tok = await page.request.post('/api/tokens', {
		data: { name: `preset-token-${suffix}`, policyId: preset.id }
	});
	expect(tok.status()).toBe(201);
	const token = (await tok.json()) as { id: string };

	await page.goto('/app/policies');
	const card = cardWith(page, presetName);
	await expect(card).toContainText('Used by 1 service · 1 token');

	await card.getByRole('button', { name: `Delete preset ${presetName}` }).click();
	const confirm = page.getByRole('alertdialog');
	await expect(confirm).toContainText(`Delete “${presetName}”?`);
	// the dialog says what happens to whatever uses the preset
	await expect(confirm).toContainText('1 service and 1 token use this preset.');
	await expect(confirm).toContainText('They will be detached');
	await confirm.getByRole('button', { name: 'Delete preset' }).click();
	await expect(confirm).toBeHidden();
	await expect(toast(page, 'Preset deleted')).toBeVisible();
	await expect(cardWith(page, presetName)).toHaveCount(0);

	await page.goto('/app/services');
	await expect(serviceRow).toBeVisible();
	await expect(serviceRow.getByRole('link', { name: presetName })).toHaveCount(0);
	// the Preset column (third) falls back to a dash
	await expect(serviceRow.getByRole('cell').nth(2)).toHaveText('—');

	const list = await page.request.get('/api/tokens');
	expect(list.status()).toBe(200);
	const tokens = (await list.json()) as { id: string; policyId: string | null }[];
	expect(tokens.find((t) => t.id === token.id)?.policyId).toBeNull();
});
