import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin, uniqueSuffix } from './helpers';
import {
	acknowledgeSecret,
	apiCreateService,
	apiCreateToken,
	apiRevokeToken,
	countTokensNamed,
	createTokenViaUi,
	createdSecretDialog,
	openCreateTokenDialog,
	rowWithLink,
	selectOption
} from './token-helpers';

/**
 * Machine tokens: the create dialog (service picker, endpoint access, model
 * patterns, double-submit guard), the one-time secret, the token table and the
 * token detail page.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
	await signInAdmin(page);
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

/** The picker trigger inside the create dialog; its text is the selected service. */
const servicePicker = (page: Page) =>
	page.getByRole('dialog', { name: 'Create machine token' }).getByLabel('Service', { exact: true });

test.describe('service picker', () => {
	test('searches services and creates a new one inline', async ({ page }) => {
		const existing = await apiCreateService(page, `picker-a-${uniqueSuffix()}`);
		const newService = `picker-new-${uniqueSuffix()}`;
		const tokenName = `picked-${uniqueSuffix()}`;

		const dialog = await openCreateTokenDialog(page);
		await dialog.getByLabel('Token name').fill(tokenName);
		await expect(servicePicker(page)).toHaveText('Default');

		await servicePicker(page).click();
		const search = page.getByPlaceholder('Search services…');
		await search.fill(existing.name);
		await expect(page.getByRole('option', { name: existing.name })).toBeVisible();
		await expect(page.getByRole('option', { name: 'Default', exact: true })).toBeHidden();
		// an existing name (in any case) is never offered for creation
		await search.fill(existing.name.toUpperCase());
		await expect(page.getByRole('option', { name: /^Create service/ })).toHaveCount(0);

		await search.fill('');
		await page.getByRole('option', { name: 'New service…' }).click();
		await page.getByPlaceholder('e.g. support-agent').fill(newService);
		await page.getByRole('button', { name: 'Create', exact: true }).click();
		await expect(servicePicker(page)).toHaveText(newService);

		await dialog.getByRole('button', { name: 'Create token' }).click();
		await acknowledgeSecret(page);
		await expect(
			rowWithLink(page, tokenName).getByRole('link', { name: newService })
		).toBeVisible();
	});

	test('rejects a duplicate service name regardless of case', async ({ page }) => {
		const existing = await apiCreateService(page, `picker-dup-${uniqueSuffix()}`);

		await openCreateTokenDialog(page);
		await servicePicker(page).click();
		await page.getByRole('option', { name: 'New service…' }).click();
		await page.getByPlaceholder('e.g. support-agent').fill(existing.name.toUpperCase());
		await page.getByRole('button', { name: 'Create', exact: true }).click();

		await expect(page.getByText('A service with this name already exists')).toBeVisible();
		await expect(servicePicker(page)).toHaveText('Default');
		// the browser logs the rejected POST itself; that 409 is the expected outcome
		const conflict = errors.findIndex((e) => e.includes('status of 409'));
		if (conflict !== -1) errors.splice(conflict, 1);
	});
});

test.describe('one-time secret dialog', () => {
	test('a hash-only secret only closes via "I\'ve copied it"', async ({ page }) => {
		await createTokenViaUi(page, { name: `once-${uniqueSuffix()}` });
		const reveal = createdSecretDialog(page);
		await expect(reveal).toBeVisible();
		await expect(reveal.getByRole('button', { name: 'Close' })).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(reveal).toBeVisible();
		// the overlay covers the page, so a corner click lands outside the dialog
		await page.mouse.click(5, 5);
		await expect(reveal).toBeVisible();

		await acknowledgeSecret(page);
	});

	test('a re-copyable secret can be dismissed normally', async ({ page }) => {
		await createTokenViaUi(page, { name: `recopy-${uniqueSuffix()}`, recopyable: true });
		const reveal = page.getByRole('dialog', { name: 'Token secret' });
		await expect(reveal.getByText(/^uprox_live_/)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(reveal).toBeHidden();
	});
});

test.describe('endpoint access', () => {
	test('"Only selected" with nothing ticked blocks the submit', async ({ page }) => {
		const tokenName = `noscope-${uniqueSuffix()}`;
		const dialog = await openCreateTokenDialog(page);
		await dialog.getByLabel('Token name').fill(tokenName);

		await dialog.getByRole('radio', { name: /Only selected/ }).click();
		const error = dialog.getByRole('alert').filter({ hasText: 'Select at least one endpoint' });
		await expect(error).toBeVisible();
		await dialog.getByRole('button', { name: 'Create token' }).click();
		await expect(dialog).toBeVisible();
		await expect(createdSecretDialog(page)).toHaveCount(0);
		expect(await countTokensNamed(page, tokenName)).toBe(0);

		await dialog.getByRole('radio', { name: /All endpoints/ }).click();
		await expect(error).toBeHidden();
	});

	test('a bundle quick pick is saved and shown by name', async ({ page }) => {
		const tokenName = `bundle-${uniqueSuffix()}`;
		const dialog = await openCreateTokenDialog(page);
		await dialog.getByLabel('Token name').fill(tokenName);

		await dialog.getByRole('button', { name: 'Chat & Responses' }).click();
		await expect(dialog.getByRole('radio', { name: /Only selected/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /Chat completions/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /^Responses/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /Model list/ })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: /^Embeddings/ })).not.toBeChecked();

		await dialog.getByRole('button', { name: 'Create token' }).click();
		await acknowledgeSecret(page);

		const row = rowWithLink(page, tokenName);
		await expect(row).toContainText('Chat & Responses');
		await row.getByRole('link', { name: tokenName, exact: true }).click();
		await expect(page.getByText('Endpoint access:').locator('..')).toContainText(
			'Chat & Responses'
		);
	});
});

test.describe('create dialog validation', () => {
	test('the allowed-models input rejects a "*" in the middle', async ({ page }) => {
		const tokenName = `badglob-${uniqueSuffix()}`;
		const dialog = await openCreateTokenDialog(page);
		await dialog.getByLabel('Token name').fill(tokenName);
		await dialog.getByRole('button', { name: /^Access/ }).click();

		await dialog.getByLabel('Allowed models').fill('gpt-*-mini');
		await dialog.getByLabel('Allowed models').press('Enter');
		const message = '“gpt-*-mini”: * is only allowed at the end (prefix match)';
		await expect(dialog.getByText(message).first()).toBeVisible();

		// the server enforces the same rule, so submitting anyway fails too
		await dialog.getByRole('button', { name: 'Create token' }).click();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText(message)).toHaveCount(2);
		expect(await countTokensNamed(page, tokenName)).toBe(0);
	});

	test('the create button is disabled while the request runs', async ({ page }) => {
		const tokenName = `once-only-${uniqueSuffix()}`;
		const dialog = await openCreateTokenDialog(page);
		await dialog.getByLabel('Token name').fill(tokenName);

		// hold the form action so the pending state is observable
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		await page.route(
			(url) => url.pathname === '/app/tokens' && url.search.includes('/create'),
			async (route) => {
				await held;
				await route.continue();
			}
		);

		await dialog.getByRole('button', { name: 'Create token' }).click();
		const pending = dialog.getByRole('button', { name: 'Creating…' });
		await expect(pending).toBeDisabled();
		// implicit submission (Enter) is suppressed while the submit button is disabled
		await dialog.getByLabel('Token name').press('Enter');
		release();

		await acknowledgeSecret(page);
		expect(await countTokensNamed(page, tokenName)).toBe(1);
	});
});

test.describe('token table', () => {
	test('searches, filters, groups and sorts', async ({ page }) => {
		const sfx = uniqueSuffix();
		const alpha = await apiCreateService(page, `tbl-alpha-${sfx}`);
		const beta = await apiCreateService(page, `tbl-beta-${sfx}`);
		const tokA = await apiCreateToken(page, { name: `tbl-${sfx}-a`, serviceId: beta.id });
		const tokB = await apiCreateToken(page, { name: `tbl-${sfx}-b`, serviceId: alpha.id });
		const tokC = await apiCreateToken(page, { name: `tbl-${sfx}-c`, serviceId: alpha.id });
		await apiRevokeToken(page, tokC.id);

		await page.goto('/app/tokens');
		await page
			.getByRole('textbox', { name: 'Search name, service, preset, model…' })
			.fill(`tbl-${sfx}-`);

		const tokenLink = (name: string) => page.getByRole('link', { name, exact: true });
		/** the visible token names, in table order */
		const order = () =>
			page
				.getByRole('row')
				.getByRole('link', { name: new RegExp(`^tbl-${sfx}-[abc]$`) })
				.allTextContents()
				.then((names) => names.map((n) => n.trim()));

		// the default "Not revoked" filter hides the revoked token, and says so
		await expect(tokenLink(tokA.name)).toBeVisible();
		await expect(tokenLink(tokB.name)).toBeVisible();
		await expect(tokenLink(tokC.name)).toHaveCount(0);
		await expect(page.getByText(/\d+ revoked hidden/)).toBeVisible();
		await page.getByRole('button', { name: 'Show all' }).click();
		await expect(tokenLink(tokC.name)).toBeVisible();

		await selectOption(
			page,
			page.getByRole('button', { name: 'Any status', exact: true }),
			'Revoked'
		);
		await expect(tokenLink(tokC.name)).toBeVisible();
		await expect(tokenLink(tokA.name)).toHaveCount(0);
		await selectOption(
			page,
			page.getByRole('button', { name: 'Revoked', exact: true }),
			'Not revoked'
		);

		await selectOption(
			page,
			page.getByRole('button', { name: 'All services', exact: true }),
			alpha.name
		);
		await expect(tokenLink(tokB.name)).toBeVisible();
		await expect(tokenLink(tokA.name)).toHaveCount(0);
		await selectOption(
			page,
			page.getByRole('button', { name: alpha.name, exact: true }),
			'All services'
		);
		await expect(tokenLink(tokA.name)).toBeVisible();

		await selectOption(
			page,
			page.getByRole('button', { name: 'No grouping', exact: true }),
			'Group by service'
		);
		const header = (service: string) =>
			page.getByRole('cell', { name: new RegExp(`^${service}\\s*·\\s*1$`) });
		await expect(header(alpha.name)).toBeVisible();
		await expect(header(beta.name)).toBeVisible();
		// groups are ordered by service name, so alpha's token comes first
		await expect.poll(order).toEqual([tokB.name, tokA.name]);
		await selectOption(
			page,
			page.getByRole('button', { name: 'Group by service', exact: true }),
			'No grouping'
		);
		await expect(header(alpha.name)).toHaveCount(0);

		// newest first by default; the Name header sorts alphabetically, then reverses
		await expect.poll(order).toEqual([tokB.name, tokA.name]);
		await page.getByRole('button', { name: 'Name', exact: true }).click();
		await expect.poll(order).toEqual([tokA.name, tokB.name]);
		await page.getByRole('button', { name: 'Name', exact: true }).click();
		await expect.poll(order).toEqual([tokB.name, tokA.name]);
	});
});

test.describe('token detail page', () => {
	test('renames, changes expiry and switches off re-copying for good', async ({ page }) => {
		const name = `detail-${uniqueSuffix()}`;
		const renamed = `${name}-renamed`;
		await createTokenViaUi(page, { name, recopyable: true });
		await page
			.getByRole('dialog', { name: 'Token secret' })
			.getByRole('button', { name: 'Done' })
			.click();

		await rowWithLink(page, name).getByRole('link', { name, exact: true }).click();
		await expect(page.getByRole('heading', { name })).toBeVisible();
		await expect(page.getByText('never expires')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		let dialog = page.getByRole('dialog', { name: 'Edit token' });
		await dialog.getByLabel('Token name').fill(renamed);
		await selectOption(page, dialog.getByLabel('Expires'), '30 days from now');
		await dialog.getByRole('button', { name: 'Save token' }).click();
		await expect(dialog).toBeHidden();
		await expect(page.getByRole('heading', { name: renamed })).toBeVisible();
		await expect(page.getByText('never expires')).toHaveCount(0);

		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Edit token' });
		await expect(dialog.getByText(/^Currently expires /)).toBeVisible();
		await dialog.getByRole('button', { name: /^Advanced/ }).click();
		const recopy = dialog.getByRole('switch', { name: 'Allow re-copying later' });
		await expect(recopy).toBeChecked();
		await recopy.click();
		await expect(dialog.getByText("Re-copying can't be turned back on.")).toBeVisible();
		await dialog.getByRole('button', { name: 'Save token' }).click();
		await expect(dialog).toBeHidden();
		await expect(page.getByRole('button', { name: 'Reveal' })).toHaveCount(0);

		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Edit token' });
		await dialog.getByRole('button', { name: /^Advanced/ }).click();
		await expect(recopy).not.toBeChecked();
		await expect(recopy).toBeDisabled();
		await expect(
			dialog.getByText("This token's secret isn't stored, so re-copying can't be turned on.")
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('revokes, then deletes back to the list', async ({ page }) => {
		const name = `doomed-${uniqueSuffix()}`;
		await createTokenViaUi(page, { name, recopyable: true });
		await page
			.getByRole('dialog', { name: 'Token secret' })
			.getByRole('button', { name: 'Done' })
			.click();
		await rowWithLink(page, name).getByRole('link', { name, exact: true }).click();
		await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

		await page.getByRole('button', { name: 'Revoke', exact: true }).click();
		await page
			.getByRole('alertdialog', { name: `Revoke “${name}”?` })
			.getByRole('button', { name: 'Revoke token' })
			.click();
		await expect(
			page.getByText(/^Revoked .+ This token can no longer authenticate\.$/)
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reveal' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
		// the revoke confirm's overlay blocks clicks until its close animation ends
		await expect(page.locator('[data-slot="alert-dialog-overlay"]')).toHaveCount(0);

		await page.getByRole('button', { name: 'Delete', exact: true }).click();
		await page
			.getByRole('alertdialog', { name: `Delete “${name}”?` })
			.getByRole('button', { name: 'Delete token' })
			.click();
		await expect(page).toHaveURL(/\/app\/tokens$/);
		await expect(page.getByText(`Token “${name}” deleted`)).toBeVisible();
		await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
	});

	test('effective settings name the layer each value comes from', async ({ page }) => {
		const service = await apiCreateService(page, `limits-svc-${uniqueSuffix()}`, {
			rateLimitPerMinute: 42
		});
		const token = await apiCreateToken(page, {
			name: `limited-${uniqueSuffix()}`,
			serviceId: service.id
		});

		await page.goto(`/app/tokens/${token.id}`);
		const rate = page
			.locator('dl > div')
			.filter({ has: page.getByText('Rate limit', { exact: true }) });
		await expect(rate).toContainText('42 req/min per token');
		await expect(rate).toContainText(`from service ${service.name}`);
	});
});
