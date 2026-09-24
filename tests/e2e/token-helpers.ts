import { expect, type Locator, type Page } from '@playwright/test';

/** Seeding helpers for the machine-token and service E2E tests. */

export interface Entity {
	id: string;
	name: string;
}

/** Create a service over the admin API (the page's session cookie authenticates it). */
export async function apiCreateService(
	page: Page,
	name: string,
	extra: Record<string, unknown> = {}
): Promise<Entity> {
	const res = await page.request.post('/api/services', { data: { name, ...extra } });
	expect(res.status(), await res.text()).toBe(201);
	return (await res.json()) as Entity;
}

/** Create a hash-only token over the admin API; the API cannot make re-copyable ones. */
export async function apiCreateToken(
	page: Page,
	data: { name: string; serviceId?: string; scopes?: string[] }
): Promise<Entity> {
	const res = await page.request.post('/api/tokens', { data });
	expect(res.status(), await res.text()).toBe(201);
	return (await res.json()) as Entity;
}

export async function apiRevokeToken(page: Page, id: string): Promise<void> {
	const res = await page.request.delete(`/api/tokens/${id}`);
	expect(res.status()).toBe(200);
}

/**
 * How many tokens (revoked or not) carry this exact name. Asks the admin API
 * rather than the database so a test holds no extra Postgres connection.
 */
export async function countTokensNamed(page: Page, name: string): Promise<number> {
	const res = await page.request.get('/api/tokens');
	expect(res.status()).toBe(200);
	const tokens = (await res.json()) as { name: string }[];
	return tokens.filter((t) => t.name === name).length;
}

/** Open the token list's create dialog and return it. */
export async function openCreateTokenDialog(page: Page): Promise<Locator> {
	await page.goto('/app/tokens');
	// the empty state repeats the button when there are no tokens yet
	await page.getByRole('button', { name: '+ New token' }).first().click();
	const dialog = page.getByRole('dialog', { name: 'Create machine token' });
	await expect(dialog).toBeVisible();
	return dialog;
}

/** The one-time reveal of a hash-only token. */
export const createdSecretDialog = (page: Page) =>
	page.getByRole('dialog', { name: 'Token created' });

/** Confirm the one-time secret dialog and wait for it to go away. */
export async function acknowledgeSecret(page: Page): Promise<void> {
	const reveal = createdSecretDialog(page);
	await expect(reveal.getByText(/^uprox_live_/)).toBeVisible();
	await reveal.getByRole('button', { name: "I've copied it" }).click();
	await expect(reveal).toBeHidden();
}

/**
 * Issue a token through the create dialog. `recopyable` flips the Advanced
 * switch, which the admin API does not expose. Leaves the secret dialog open.
 */
export async function createTokenViaUi(
	page: Page,
	opts: { name: string; recopyable?: boolean }
): Promise<void> {
	const dialog = await openCreateTokenDialog(page);
	await dialog.getByLabel('Token name').fill(opts.name);
	if (opts.recopyable) {
		await dialog.getByRole('button', { name: /^Advanced/ }).click();
		await dialog.getByRole('switch', { name: 'Allow re-copying later' }).click();
	}
	await dialog.getByRole('button', { name: 'Create token' }).click();
	await expect(dialog).toBeHidden();
}

/** Pick an option in a bits-ui select; its trigger is a button named after the current value. */
export async function selectOption(page: Page, trigger: Locator, option: string): Promise<void> {
	await trigger.click();
	await page.getByRole('option', { name: option, exact: true }).click();
	// the page ignores pointer events until the closing listbox is gone
	await expect(page.getByRole('listbox')).toHaveCount(0);
}

/** A table row that contains a link with exactly this text. */
export const rowWithLink = (page: Page, name: string) =>
	page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
