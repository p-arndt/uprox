import { test, expect, type Locator, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin } from './helpers';
import { cardWith, skipNativeValidation, toast } from './admin-helpers';

/**
 * /app/settings: the grouped layout, per-card validation errors, and saves that
 * persist. Every test restores the values it changed, since the settings are
 * instance-wide and other specs run against the same instance.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
	await signInAdmin(page);
	await page.goto('/app/settings');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

/** Save one card's form and wait for its own toast. */
async function saveCard(page: Page, card: Locator, savedMessage: string) {
	await card.getByRole('button', { name: 'Save' }).click();
	await expect(toast(page, savedMessage)).toBeVisible();
}

test('cards are grouped under Access, Spend and Performance', async ({ page }) => {
	const groups = {
		access: ['Access', ['Member permissions', 'Token security']],
		spend: ['Spend', ['Instance budget', 'Budget alerts']],
		performance: ['Performance', ['Response cache']]
	} as const;

	for (const [id, [heading, cards]] of Object.entries(groups)) {
		const section = page.locator(`section#${id}`);
		await expect(section.getByRole('heading', { name: heading, exact: true })).toBeVisible();
		for (const card of cards) {
			await expect(section.getByText(card, { exact: true })).toBeVisible();
		}
	}
	// the sections keep their reading order
	const headings = await page.locator('section > div > h2').allTextContents();
	expect(headings.map((h) => h.trim())).toEqual(['Access', 'Spend', 'Performance']);
});

test('a negative cache TTL is rejected in its card and not saved', async ({ page }) => {
	const card = cardWith(page, 'Response cache');
	const ttl = card.getByLabel('Default cache TTL (seconds)');
	const before = await ttl.inputValue();

	await ttl.fill('-5');
	await skipNativeValidation(ttl);
	await card.getByRole('button', { name: 'Save' }).click();
	await expect(card.getByText('Cache TTL must be a non-negative number')).toBeVisible();
	await expect(toast(page, 'Cache settings saved')).toHaveCount(0);
	// the error stays with the card that caused it
	await expect(cardWith(page, 'Instance budget')).not.toContainText('must be');

	await page.reload();
	await expect(ttl).toHaveValue(before);
	await expect(card.getByText('Cache TTL must be a non-negative number')).toHaveCount(0);
});

test('a valid cache TTL saves with its own toast and survives a reload', async ({ page }) => {
	const card = cardWith(page, 'Response cache');
	const ttl = card.getByLabel('Default cache TTL (seconds)');
	const before = await ttl.inputValue();
	const next = before === '1234' ? '4321' : '1234';

	await ttl.fill(next);
	await saveCard(page, card, 'Cache settings saved');
	await page.reload();
	await expect(ttl).toHaveValue(next);

	await ttl.fill(before);
	await saveCard(page, card, 'Cache settings saved');
	await page.reload();
	await expect(ttl).toHaveValue(before);
});

test('a negative instance budget is rejected, a valid one persists', async ({ page }) => {
	const card = cardWith(page, 'Instance budget');
	const daily = card.getByLabel('Daily ceiling (USD)');
	const monthly = card.getByLabel('Monthly ceiling (USD)');
	const before = { daily: await daily.inputValue(), monthly: await monthly.inputValue() };

	await daily.fill('-1');
	await skipNativeValidation(daily);
	await card.getByRole('button', { name: 'Save' }).click();
	await expect(card.getByText('Budgets must be non-negative numbers')).toBeVisible();
	await expect(toast(page, 'Instance budget saved')).toHaveCount(0);
	await page.reload();
	await expect(daily).toHaveValue(before.daily);

	// high enough never to deny the gateway traffic other specs rely on
	await daily.fill('98765.43');
	await monthly.fill('987654');
	await saveCard(page, card, 'Instance budget saved');
	await expect(card.getByText('Budgets must be non-negative numbers')).toHaveCount(0);
	await page.reload();
	await expect(daily).toHaveValue('98765.43');
	await expect(monthly).toHaveValue('987654');

	await daily.fill(before.daily);
	await monthly.fill(before.monthly);
	await saveCard(page, card, 'Instance budget saved');
	await page.reload();
	await expect(daily).toHaveValue(before.daily);
	await expect(monthly).toHaveValue(before.monthly);
});
