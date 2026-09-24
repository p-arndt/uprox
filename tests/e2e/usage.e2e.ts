import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin, testDb } from './helpers';

/**
 * The cost-analysis page (/app/usage). Gateway traffic cannot be produced from
 * the UI without a real upstream, so audit rows are seeded straight into the
 * test database. Rows span the last ~80 days (plus a few minutes ago, so the
 * rolling windows always contain traffic) across two services and two models.
 *
 * The seed is idempotent (fixed service names, skipped when present): Playwright
 * re-runs `beforeAll` in a fresh worker after a failure, and a second copy of the
 * traffic would both change the figures and be hidden by the page's query cache.
 */

const ALPHA = 'usage-e2e-alpha';
const BETA = 'usage-e2e-beta';
let alphaId = '';

const DAY_MS = 86_400_000;

test.beforeAll(async ({ browser }) => {
	// the first sign-in bootstraps the instance if this spec runs alone
	const page = await browser.newPage();
	await signInAdmin(page);
	await page.close();

	const sql = testDb();
	try {
		const existing = await sql<{ id: string; name: string }[]>`
			select id, name from service where name in (${ALPHA}, ${BETA})
		`;
		if (existing.length === 2) {
			alphaId = existing.find((s) => s.name === ALPHA)!.id;
			return;
		}

		const [alpha, beta] = await sql<{ id: string }[]>`
			insert into service ${sql([
				{ name: ALPHA, type: 'agent', description: 'e2e usage seed' },
				{ name: BETA, type: 'workload', description: 'e2e usage seed' }
			])}
			returning id
		`;
		if (!alpha || !beta) throw new Error('seeding the usage services returned no rows');
		alphaId = alpha.id;

		const now = Date.now();
		const rows = [];
		// one request per "slot": minutes ago up to 80 days back, alternating
		// services and models so every grouping has more than one series
		const offsets = [2 * 60_000, 10 * 60_000, 60 * 60_000];
		for (let day = 1; day <= 80; day += 3) offsets.push(day * DAY_MS + 3_600_000);
		offsets.forEach((offset, i) => {
			const alphaRow = i % 2 === 0;
			rows.push({
				service_id: alphaRow ? alpha.id : beta.id,
				action: 'gateway.chat',
				provider: 'openai',
				model: alphaRow ? 'gpt-5.5' : 'gpt-4o-mini',
				status: 'ok',
				status_code: 200,
				cost_usd: alphaRow ? '1.250000' : '0.420000',
				input_tokens: 12_000 + i * 10,
				output_tokens: 800 + i,
				provider_cached_tokens: 2_000,
				context_tier: 'standard',
				latency_ms: 400 + i * 7,
				ip: '10.0.0.1',
				created_at: new Date(now - offset)
			});
		});
		// a denial inside the rolling windows, so the status dimension has two values
		rows.push({
			service_id: beta.id,
			action: 'gateway.chat',
			provider: 'openai',
			model: 'gpt-4o-mini',
			status: 'deny',
			status_code: 429,
			cost_usd: null,
			input_tokens: null,
			output_tokens: null,
			provider_cached_tokens: null,
			context_tier: null,
			latency_ms: 3,
			ip: '10.0.0.1',
			created_at: new Date(now - 5 * 60_000)
		});
		await sql`insert into audit_log ${sql(rows)}`;
	} finally {
		await sql.end();
	}
});

/** Wait until every streamed panel on screen has settled. */
async function expectStreamsSettled(page: Page) {
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
	await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
	await expect(page.getByText('This panel could not be loaded')).toHaveCount(0);
	await expect(page.getByText('Comparison unavailable')).toHaveCount(0);
	await expect(page.getByText('Budget headroom could not be loaded')).toHaveCount(0);
}

/** The value cell under a headline label ("Spend", "Requests", ...). */
const headlineValue = (page: Page, label: string) =>
	page.locator(`p:text-is("${label}") + p`).first();

/** The popover a toolbar dropdown opens. */
const popover = (page: Page) => page.locator('[data-slot="popover-content"]');

test.describe('cost analysis page', () => {
	let errors: string[];

	test.beforeEach(async ({ page }) => {
		errors = collectPageErrors(page);
		await signInAdmin(page);
	});

	test.afterEach(() => {
		expect(errors, 'browser console errors').toEqual([]);
	});

	test('renders the headline and chart with non-zero spend', async ({ page }) => {
		await page.goto('/app/usage?range=30d&group=service');

		await expect(page.getByRole('heading', { name: 'Cost analysis' })).toBeVisible();
		await expect(headlineValue(page, 'Spend')).toHaveText(/\$\d/);
		await expect(headlineValue(page, 'Spend')).not.toHaveText(/^\$0\.00$/);
		await expect(headlineValue(page, 'Requests')).not.toHaveText(/^0$/);

		const chart = page.locator('[data-slot="card"]').filter({ hasText: 'Spend over time' });
		await expect(chart).toBeVisible();
		await expect(chart.locator('svg').first()).toBeVisible();

		// the breakdown lists both seeded services, linking to their detail pages
		await expect(page.getByRole('link', { name: ALPHA, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: BETA, exact: true })).toBeVisible();
	});

	test('streamed panels resolve without inline errors', async ({ page }) => {
		await page.goto('/app/usage?range=30d');
		await expectStreamsSettled(page);

		// the previous-period comparison landed in the headline, and its tooltip
		// names the exact dates it compares against
		const comparison = page.getByText('vs previous period').first();
		await expect(comparison).toBeVisible();
		await comparison.hover();
		await expect(page.getByText(/^Compared with .*\d{4}/).first()).toBeVisible();

		// each secondary panel is behind a tab; open every one that is offered
		for (const tab of ['What changed', 'Composition', 'Model efficiency', 'Token meters']) {
			const trigger = page.getByRole('tab', { name: tab });
			if ((await trigger.count()) === 0) continue;
			await trigger.click();
			await expect(trigger).toHaveAttribute('data-state', 'active');
			await expectStreamsSettled(page);
		}
		// with two models, two services and a previous window, these must be offered
		await expect(page.getByRole('tab', { name: 'Composition' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Model efficiency' })).toBeVisible();
	});

	test('switching the range updates the URL and the content', async ({ page }) => {
		await page.goto('/app/usage?range=30d');
		const description = page
			.locator('[data-slot="card"]')
			.filter({ hasText: 'Spend over time' })
			.getByText(/ · by model · /);
		await expect(description).toContainText('30 days');
		const spend30 = await headlineValue(page, 'Spend').textContent();

		for (const [key, label] of [
			['7d', '7 days'],
			['90d', '90 days']
		] as const) {
			// the range picker's trigger is labelled with the active range
			await page.getByRole('button', { name: /^\d+ days$/ }).click();
			await popover(page).getByRole('link', { name: label, exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`[?&]range=${key}(&|$)`));
			await expect(description).toContainText(label);
			await expectStreamsSettled(page);
		}

		// 90 days covers every seeded row, 30 days only part of them
		await expect(headlineValue(page, 'Spend')).not.toHaveText(spend30 ?? '');
	});

	test('changing group-by regroups the breakdown', async ({ page }) => {
		// model is the default grouping, so it is not in the URL
		await page.goto('/app/usage?range=30d');
		await expect(page.getByText('Detail by model')).toBeVisible();
		await expect(page.getByRole('cell', { name: 'gpt-5.5' }).first()).toBeVisible();

		await page.getByRole('button', { name: /Group by/ }).click();
		await popover(page).getByRole('button', { name: 'Service', exact: true }).click();

		await expect(page).toHaveURL(/[?&]group=service(&|$)/);
		await expect(page.getByText('Detail by service')).toBeVisible();
		await expect(page.getByRole('button', { name: /Group by\s*Service/ })).toBeVisible();
		await expect(page.getByRole('link', { name: ALPHA, exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: BETA, exact: true })).toBeVisible();
		await expectStreamsSettled(page);
	});

	test('adds and removes a filter pill', async ({ page }) => {
		await page.goto('/app/usage?range=30d&group=service');
		await expectStreamsSettled(page);

		await page.getByRole('button', { name: 'Add filter' }).click();
		await popover(page).getByRole('button', { name: 'Service', exact: true }).click();
		await popover(page).locator('[data-slot="command-item"]').filter({ hasText: ALPHA }).click();

		await expect(page).toHaveURL(new RegExp(`[?&]f=service(%3A|:)${alphaId}`));
		await page.keyboard.press('Escape');

		const remove = page.getByRole('button', { name: `Remove filter Service: ${ALPHA}` });
		await expect(remove).toBeVisible();
		// the filtered breakdown no longer lists the other service
		await expect(page.getByRole('link', { name: BETA, exact: true })).toHaveCount(0);

		await remove.click();
		await expect(page).not.toHaveURL(/[?&]f=/);
		await expect(remove).toHaveCount(0);
		await expect(page.getByRole('link', { name: BETA, exact: true })).toBeVisible();
	});

	test('refresh reloads with fresh=1 and then strips it from the URL', async ({ page }) => {
		await page.goto('/app/usage?range=30d&group=service');
		await expectStreamsSettled(page);

		const freshRequest = page.waitForRequest((req) => req.url().includes('fresh=1'));
		await page.getByRole('button', { name: 'Refresh usage' }).click();
		await freshRequest;

		await expect(page.getByRole('button', { name: 'Refresh usage' })).toBeEnabled();
		await expect(page).not.toHaveURL(/fresh=/);
		// the rest of the view state survives the refresh
		await expect(page).toHaveURL(/[?&]range=30d(&|$)/);
		await expect(page).toHaveURL(/[?&]group=service(&|$)/);
		await expectStreamsSettled(page);
	});

	test('export links return CSV', async ({ page }) => {
		await page.goto('/app/usage?range=30d&group=service');

		for (const [item, header] of [
			['Breakdown (CSV)', 'Service,Detail,Spend (USD)'],
			['Time series (CSV)', 'Bucket,Service,Spend (USD)']
		] as const) {
			await page.getByRole('button', { name: 'Export' }).click();
			const link = page.getByRole('menuitem', { name: item });
			const href = await link.getAttribute('href');
			expect(href).toContain('group=service');
			await page.keyboard.press('Escape');

			const res = await page.request.get(href!);
			expect(res.status()).toBe(200);
			expect(res.headers()['content-type']).toContain('text/csv');
			const body = await res.text();
			expect(body).toContain(header);
			expect(body).toContain(ALPHA);
		}
	});

	test('a window without traffic renders the empty state', async ({ page }) => {
		await page.goto('/app/usage?range=custom&from=2001-01-01&to=2001-01-02');

		await expect(page.getByRole('heading', { name: 'Cost analysis' })).toBeVisible();
		const empty = page.getByText(/No gateway traffic for/);
		await expect(empty).toBeVisible();
		// the custom range is labelled as a readable date span (en-US in Playwright)
		await expect(empty).toContainText(/Jan 1\s*–\s*2, 2001/);
		await expectStreamsSettled(page);
		// the range label is interpolated, not the template source
		// (regression from d4ab6a8, src/lib/components/usage-workbench.svelte:81-83)
		await expect(empty).not.toContainText('rangeLabel=');

		// the gateway has traffic outside this window, so the page says when it
		// last saw a request instead of implying nothing was ever proxied
		await expect(page.getByText(/^Last request:/)).toBeVisible();
		await expect(page.getByText('Nothing proxied yet')).toHaveCount(0);

		// a custom window offers the rolling presets to widen to
		const widen7 = page.getByRole('link', { name: 'Show 7 days' });
		await expect(widen7).toBeVisible();
		await expect(page.getByRole('link', { name: 'Show 30 days' })).toBeVisible();
		await widen7.click();
		await expect(page).toHaveURL(/[?&]range=7d(&|$)/);
		await expect(empty).toHaveCount(0);
		await expect(headlineValue(page, 'Requests')).not.toHaveText(/^0$/);
	});

	test('the headline has an errors & denials cell counting the seeded denial', async ({
		page
	}) => {
		await page.goto('/app/usage?range=7d');
		await expectStreamsSettled(page);

		const cell = page.locator('p:text-is("Errors & denials")').locator('..');
		await expect(headlineValue(page, 'Errors & denials')).toHaveText(/^\d+\.\d%$/);
		await expect(headlineValue(page, 'Errors & denials')).not.toHaveText('0.0%');
		await expect(cell).toContainText(/\d+ errors · [1-9]\d* denied/);
	});

	test('the chart metric switch is kept in the URL', async ({ page }) => {
		await page.goto('/app/usage?range=30d');
		const metrics = page.getByRole('group', { name: 'Chart metric' });
		await expect(metrics.getByRole('button', { name: 'Spend' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await metrics.getByRole('button', { name: 'Tokens' }).click();
		await expect(page).toHaveURL(/[?&]metric=tokens(&|$)/);
		await expect(page.getByText('Tokens over time')).toBeVisible();

		// a reload (or a shared link) restores the picked metric
		await page.reload();
		await expect(metrics.getByRole('button', { name: 'Tokens' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(page.getByText('Tokens over time')).toBeVisible();

		// the default metric is not spelled out in the URL
		await metrics.getByRole('button', { name: 'Spend' }).click();
		await expect(page).not.toHaveURL(/[?&]metric=/);
		await expect(page.getByText('Spend over time')).toBeVisible();
	});

	test('a budget ceiling shows its gauge between the headline and the chart', async ({
		page
	}) => {
		await setInstanceMonthlyBudget(page, '100000');
		try {
			await page.goto('/app/usage?range=30d');
			await expectStreamsSettled(page);

			const gauge = page
				.locator('[data-slot="card"]')
				.filter({ has: page.getByText('Budget headroom', { exact: true }) });
			await expect(gauge).toBeVisible();
			await expect(gauge).toContainText('$100,000.00');

			const chart = page.locator('[data-slot="card"]').filter({ hasText: 'Spend over time' });
			const headline = headlineValue(page, 'Spend');
			const [headlineBox, gaugeBox, chartBox] = await Promise.all([
				headline.boundingBox(),
				gauge.boundingBox(),
				chart.boundingBox()
			]);
			expect(gaugeBox!.y).toBeGreaterThan(headlineBox!.y);
			expect(gaugeBox!.y).toBeLessThan(chartBox!.y);
		} finally {
			// an instance ceiling is enforced by the gateway, so never leave one behind
			await setInstanceMonthlyBudget(page, '');
		}
	});
});

/** Set (or with '' clear) the instance's monthly ceiling through the settings page. */
async function setInstanceMonthlyBudget(page: Page, value: string) {
	await page.goto('/app/settings');
	const card = page
		.locator('[data-slot="card"]')
		.filter({ has: page.getByText('Instance budget', { exact: true }) });
	await card.getByLabel('Monthly ceiling (USD)').fill(value);
	await card.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Instance budget saved')).toBeVisible();
}
