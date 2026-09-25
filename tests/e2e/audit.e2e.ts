import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin, testDb, uniqueSuffix } from './helpers';
import { pickOption } from './admin-helpers';

/**
 * The audit log (/app/audit): server-side search, filters and pagination.
 *
 * A service and token are created over the admin API (which audits a
 * "token.create" row), then gateway rows for that token are seeded straight
 * into the database: gateway traffic cannot be produced without a real
 * upstream. Every seeded row carries this run's marker, so searching for it
 * isolates them from whatever other specs logged. More rows than one page (50)
 * are seeded so "Load more" has something to fetch.
 *
 * The seeded gateway rows are removed again afterwards, so specs that assert on
 * traffic figures don't see them.
 */

const MARKER = `audlog-${uniqueSuffix()}`;
const SERVICE = `${MARKER}-svc`;
const TOKEN = `${MARKER}-token`;
const MODEL = `${MARKER}-model`;
const OK_ROWS = 55;
// ok rows + one denial + one error + the token.create admin row
const TOTAL = OK_ROWS + 3;
const PAGE_SIZE = 50;

let serviceId = '';

test.beforeAll(async ({ browser }) => {
	const page = await browser.newPage();
	await signInAdmin(page);
	const svc = await page.request.post('/api/services', { data: { name: SERVICE } });
	expect(svc.status()).toBe(201);
	serviceId = ((await svc.json()) as { id: string }).id;
	const tok = await page.request.post('/api/tokens', { data: { name: TOKEN, serviceId } });
	expect(tok.status()).toBe(201);
	const tokenId = ((await tok.json()) as { id: string }).id;
	await page.close();

	const now = Date.now();
	const base = {
		service_id: serviceId,
		token_id: tokenId,
		action: 'gateway.chat',
		provider: 'openai',
		model: MODEL,
		ip: '10.9.8.7',
		// postgres.js takes the column list from the first row, so every row needs every key
		detail: null as string | null
	};
	const rows = [];
	// older than the token.create row, so that one stays on top of the log
	for (let i = 0; i < OK_ROWS; i++) {
		rows.push({
			...base,
			status: 'ok',
			status_code: 200,
			latency_ms: 100 + i,
			created_at: new Date(now - (i + 2) * 60_000)
		});
	}
	rows.push({
		...base,
		status: 'deny',
		status_code: 429,
		latency_ms: 2,
		detail: 'rate limit exceeded',
		created_at: new Date(now - 90_000)
	});
	rows.push({
		...base,
		status: 'error',
		status_code: 502,
		latency_ms: 800,
		detail: 'upstream unavailable',
		created_at: new Date(now - 100_000)
	});

	const sql = testDb();
	try {
		await sql`insert into audit_log ${sql(rows)}`;
	} finally {
		await sql.end();
	}
});

test.afterAll(async () => {
	if (!serviceId) return;
	const sql = testDb();
	try {
		await sql`delete from audit_log where service_id = ${serviceId} and action like 'gateway.%'`;
	} finally {
		await sql.end();
	}
});

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
	await signInAdmin(page);
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

const bodyRows = (page: Page) => page.locator('tbody tr');
const summary = (page: Page) => page.getByText(/Showing\s+\d+\s+events?/);
// By aria-label rather than getByRole('combobox'): with a full page of rows the
// role query stalled the page until the test timed out (seen repeatedly).
const statusSelect = (page: Page) => page.locator('button[aria-label="Status"]');
const kindSelect = (page: Page) => page.locator('button[aria-label="Event kind"]');
const searchBox = (page: Page) =>
	page.getByRole('textbox', { name: 'Search action, model, service, token, IP…' });

test('search runs on the server, lives in the URL and survives a reload', async ({ page }) => {
	await page.goto('/app/audit');
	// typing before hydration lands in the server-rendered input without a
	// handler, so retry until the debounced search has reached the URL
	await expect(async () => {
		await searchBox(page).fill('');
		await searchBox(page).fill(MARKER);
		await expect(page).toHaveURL(new RegExp(`[?&]q=${MARKER}(&|$)`), { timeout: 2_000 });
	}).toPass();
	// a full page of matches, with more on the server
	await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);
	await expect(summary(page)).toContainText(
		`Showing ${PAGE_SIZE} events, newest first — more available`
	);

	await page.reload();
	await expect(searchBox(page)).toHaveValue(MARKER);
	await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);
	for (const row of await bodyRows(page).all()) {
		await expect(row).toContainText(MARKER);
	}

	await page.getByRole('button', { name: 'Clear' }).click();
	await expect(page).not.toHaveURL(/[?&]q=/);
	await expect(searchBox(page)).toHaveValue('');
});

test('"Load more" appends the next page', async ({ page }) => {
	await page.goto(`/app/audit?q=${MARKER}`);
	await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);
	const firstPage = await bodyRows(page).allTextContents();

	await page.getByRole('button', { name: 'Load more' }).click();
	await expect(bodyRows(page)).toHaveCount(TOTAL);
	await expect(summary(page)).toContainText(`Showing ${TOTAL} events`);
	await expect(summary(page)).not.toContainText('more available');
	await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

	// the first page is kept in place and the new rows come after it
	const all = await bodyRows(page).allTextContents();
	expect(all.slice(0, PAGE_SIZE)).toEqual(firstPage);
	expect(new Set(all).size).toBeGreaterThan(PAGE_SIZE);
});

test('status and kind filters narrow the log', async ({ page }) => {
	await page.goto(`/app/audit?q=${MARKER}`);
	await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);

	await pickOption(page, statusSelect(page), 'Denied');
	await expect(page).toHaveURL(/[?&]status=denied(&|$)/);
	await expect(bodyRows(page)).toHaveCount(1);
	await expect(bodyRows(page)).toContainText('deny 429');
	await expect(bodyRows(page)).toContainText('rate limit exceeded');

	await pickOption(page, statusSelect(page), 'Errors');
	await expect(page).toHaveURL(/[?&]status=error(&|$)/);
	await expect(bodyRows(page)).toHaveCount(1);
	await expect(bodyRows(page)).toContainText('error 502');

	await pickOption(page, statusSelect(page), 'All statuses');
	await expect(page).not.toHaveURL(/[?&]status=/);

	await pickOption(page, kindSelect(page), 'Admin');
	await expect(page).toHaveURL(/[?&]kind=admin(&|$)/);
	await expect(bodyRows(page)).toHaveCount(1);
	await expect(bodyRows(page)).toContainText('Token created');

	await pickOption(page, kindSelect(page), 'Gateway');
	await expect(page).toHaveURL(/[?&]kind=gateway(&|$)/);
	await expect(bodyRows(page)).toHaveCount(PAGE_SIZE);
	await expect(bodyRows(page).filter({ hasText: 'Token created' })).toHaveCount(0);

	// filters combine, and a combination with no match says so
	await pickOption(page, kindSelect(page), 'Admin');
	await pickOption(page, statusSelect(page), 'Denied');
	await expect(page.getByText('No matching events')).toBeVisible();
	await expect(bodyRows(page)).toHaveCount(0);
});

test('rows show readable action labels and the token name for gateway calls', async ({ page }) => {
	await page.goto(`/app/audit?q=${MARKER}`);

	const admin = bodyRows(page).filter({ hasText: 'Token created' });
	await expect(admin).toHaveCount(1);
	// the raw action id is kept as a tooltip, not as the label
	await expect(admin.locator('[title="token.create"]')).toBeVisible();
	await expect(admin.getByRole('cell').nth(4)).toHaveText(SERVICE);

	const gateway = bodyRows(page).filter({ hasText: 'Chat request' }).first();
	await expect(gateway).not.toContainText('gateway.chat');
	// Who: the machine token that made the call
	const who = gateway.getByRole('cell').nth(3);
	await expect(who).toHaveText(TOKEN);
	await expect(who.locator('[title="Machine token"]')).toBeVisible();
	await expect(gateway.getByRole('cell').nth(4)).toHaveText(SERVICE);
	await expect(gateway).toContainText(MODEL);
});
