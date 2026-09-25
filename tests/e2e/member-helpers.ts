import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { APP_URL, testDb, uniqueSuffix, type TestUser } from './helpers';

export interface JoinedMember {
	user: TestUser;
	context: BrowserContext;
	page: Page;
}

/**
 * Invite a fresh address from the members page (as the signed-in admin on
 * `adminPage`) and accept the invitation in a separate browser context, so the
 * two sessions never share cookies. The invite link is read from the database:
 * without SMTP the app only exposes it through the clipboard.
 */
export async function inviteAndJoin(adminPage: Page, browser: Browser): Promise<JoinedMember> {
	const suffix = uniqueSuffix();
	const user: TestUser = {
		name: `Grace ${suffix}`,
		email: `e2e-member-${suffix}@example.com`,
		password: 'correct-horse-battery-staple'
	};

	await adminPage.goto('/app/members');
	await adminPage.getByRole('button', { name: 'Invite member' }).click();
	const dialog = adminPage.getByRole('dialog', { name: 'Invite a member' });
	await dialog.getByLabel('Email').fill(user.email);
	await dialog.getByRole('button', { name: 'Send invitation' }).click();
	await expect(adminPage.getByText(`Invitation sent to ${user.email}`)).toBeVisible();
	await expect(adminPage.getByRole('cell', { name: user.email, exact: true })).toBeVisible();

	const sql = testDb();
	let invitationId: string;
	try {
		const [row] = await sql<{ id: string }[]>`
			select id from invitation where email = ${user.email}
		`;
		if (!row) throw new Error(`no invitation for ${user.email}`);
		invitationId = row.id;
	} finally {
		await sql.end();
	}

	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`/invite/${invitationId}`);
	await expect(page.getByRole('heading', { name: "You've been invited" })).toBeVisible();
	await page.getByLabel('Name').fill(user.name);
	await page.getByLabel('Password', { exact: true }).fill(user.password);
	await page.getByLabel('Confirm password').fill(user.password);
	await page.getByRole('button', { name: 'Create account & join' }).click();
	await page.waitForURL(APP_URL);
	await expect(page.getByRole('link', { name: 'Services', exact: true })).toBeVisible();

	return { user, context, page };
}

/**
 * Flip the org's "Members can manage …" switches on the settings page and save.
 * Pass only the switches to change.
 */
export async function setMemberPermissions(
	adminPage: Page,
	perms: { tokens?: boolean; services?: boolean }
) {
	await adminPage.goto('/app/settings');
	const card = adminPage
		.locator('[data-slot="card"]')
		.filter({ has: adminPage.getByText('Member permissions', { exact: true }) });
	const switches = [
		['Members can manage machine tokens', perms.tokens],
		['Members can manage services', perms.services]
	] as const;
	for (const [label, on] of switches) {
		if (on === undefined) continue;
		const toggle = card.getByRole('switch', { name: label });
		if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', String(on));
	}
	await card.getByRole('button', { name: 'Save' }).click();
	await expect(adminPage.getByText('Member permissions saved').first()).toBeVisible();
}
