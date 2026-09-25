import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin } from './helpers';
import { inviteAndJoin, setMemberPermissions, type JoinedMember } from './member-helpers';

/**
 * Members, roles and what a plain member may do. One invited member is shared
 * by the whole file (serial): joining costs a sign-up, and the later tests
 * depend on the earlier ones leaving the member a plain member until the
 * promotion test and still present until the removal test.
 */

test.describe.configure({ mode: 'serial' });

let member: JoinedMember;
let adminPage: Page;
let errors: string[];
let memberErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
	adminPage = await browser.newPage();
	errors = collectPageErrors(adminPage);
	await signInAdmin(adminPage);
	member = await inviteAndJoin(adminPage, browser);
	memberErrors = collectPageErrors(member.page);
});

test.afterAll(async () => {
	await member?.context.close();
	await adminPage?.close();
});

test.afterEach(() => {
	expect(errors, 'admin browser console errors').toEqual([]);
	expect(memberErrors, 'member browser console errors').toEqual([]);
});

/** The sidebar entry for a nav label, badge included. */
const navItem = (page: Page, label: string) =>
	page
		.locator('[data-sidebar="menu-item"]')
		.filter({ has: page.getByRole('link', { name: label, exact: true }) });

test.describe('members and roles', () => {
	test('the invited member appears in the list and the invitation is used up', async () => {
		await adminPage.goto('/app/members');
		const row = adminPage.getByRole('row').filter({ hasText: member.user.email });
		await expect(row).toHaveCount(1);
		await expect(row.getByRole('button', { name: `Role of ${member.user.name}` })).toHaveText(
			'Member'
		);
		// accepted, so no longer pending
		await expect(
			adminPage.getByRole('button', { name: `Copy invite link for ${member.user.email}` })
		).toHaveCount(0);
	});

	test('a member sees Members and Settings as view only', async () => {
		const { page } = member;
		await page.goto('/app/members');

		for (const label of ['Members', 'Settings']) {
			await expect(navItem(page, label)).toContainText('View only');
		}
		await expect(navItem(page, 'Services')).not.toContainText('View only');
		// the admin sees no such badge
		await expect(navItem(adminPage, 'Members')).not.toContainText('View only');

		// read-only list: no invite button, no role select, no remove button
		await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Role of / })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
		await expect(
			page.getByText('Admins set this under Settings → Member permissions.')
		).toBeVisible();

		// settings: only the cache card, disabled, with no save button
		await page.goto('/app/settings');
		const cache = page
			.locator('[data-slot="card"]')
			.filter({ has: page.getByText('Response cache', { exact: true }) });
		await expect(cache).toBeVisible();
		await expect(cache.getByText('Only admins can change settings.')).toBeVisible();
		await expect(cache.getByLabel('Default cache TTL (seconds)')).toBeDisabled();
		await expect(cache.getByRole('button', { name: 'Save' })).toHaveCount(0);
		await expect(page.getByText('Member permissions', { exact: true })).toHaveCount(0);
		await expect(page.getByText('Instance budget', { exact: true })).toHaveCount(0);
	});

	test('members gain create buttons only when the org lets them manage', async () => {
		const { page } = member;
		const newService = page.getByRole('button', { name: 'New service' }).first();
		const newToken = page.getByRole('button', { name: 'New token' }).first();

		await page.goto('/app/services');
		await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
		await expect(newService).toHaveCount(0);
		await page.goto('/app/tokens');
		await expect(page.getByRole('heading', { name: 'Machine Tokens' })).toBeVisible();
		await expect(newToken).toHaveCount(0);

		await setMemberPermissions(adminPage, { tokens: true, services: true });
		try {
			await page.goto('/app/services');
			await expect(newService).toBeVisible();
			await page.goto('/app/tokens');
			await expect(newToken).toBeVisible();

			// the role legend reflects the grant
			await page.goto('/app/members');
			await expect(
				page.getByText(/can currently manage machine tokens and services/)
			).toBeVisible();
		} finally {
			// members are read-only by default; the rest of the suite expects that
			await setMemberPermissions(adminPage, { tokens: false, services: false });
		}

		await page.goto('/app/services');
		await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
		await expect(newService).toHaveCount(0);
	});

	test('promoting to admin asks first; cancel keeps the role, confirm applies it', async () => {
		await adminPage.goto('/app/members');
		const select = adminPage.getByRole('button', { name: `Role of ${member.user.name}` });
		const confirm = adminPage.getByRole('alertdialog');

		await select.click();
		await adminPage.getByRole('option', { name: 'Admin', exact: true }).click();
		await expect(confirm).toBeVisible();
		await expect(confirm).toContainText(`Make ${member.user.name} an admin?`);
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirm).toHaveCount(0);
		await expect(select).toHaveText('Member');
		// nothing was saved: a reload still shows the member role
		await adminPage.reload();
		await expect(select).toHaveText('Member');

		await select.click();
		await adminPage.getByRole('option', { name: 'Admin', exact: true }).click();
		await confirm.getByRole('button', { name: 'Make admin' }).click();
		await expect(adminPage.getByText('Role updated to Admin')).toBeVisible();
		await adminPage.reload();
		await expect(select).toHaveText('Admin');

		// the promoted member now manages members and settings
		await member.page.goto('/app/members');
		await expect(navItem(member.page, 'Members')).not.toContainText('View only');
		await expect(member.page.getByRole('button', { name: 'Invite member' })).toBeVisible();
	});

	test('removing a member confirms and names them', async () => {
		await adminPage.goto('/app/members');
		await adminPage.getByRole('button', { name: `Remove ${member.user.name}` }).click();
		const confirm = adminPage.getByRole('alertdialog');
		await expect(confirm).toContainText(`Remove ${member.user.name}?`);
		await confirm.getByRole('button', { name: 'Remove member' }).click();

		await expect(adminPage.getByText(`Removed ${member.user.name}`)).toBeVisible();
		await expect(adminPage.getByRole('row').filter({ hasText: member.user.email })).toHaveCount(0);
	});
});
