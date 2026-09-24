import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, signInAdmin, uniqueSuffix } from './helpers';
import { MOCK_MODEL, mockReply } from './mock-upstream';
import { chat, createMockProviderKey, createMockService, createToken } from './gateway-helpers';

/**
 * The gateway end to end against the local mock upstream (see mock-upstream.ts):
 * a provider key, a service and a machine token are set up, `/v1` is called
 * with the token like an SDK would, and the traffic shows up on the dashboard.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
	errors = collectPageErrors(page);
	await signInAdmin(page);
});

test.afterEach(() => {
	expect(errors, 'browser console errors').toEqual([]);
});

/** The audit log rows matching a search, newest first. */
async function auditRows(page: Page, params: Record<string, string>) {
	await page.goto(`/app/audit?${new URLSearchParams(params)}`);
	await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
	return page.getByRole('row').filter({ has: page.getByRole('cell') });
}

test('a token created in the dashboard proxies chat completions to the upstream', async ({
	page,
	request
}) => {
	const suffix = uniqueSuffix();
	const secretId = await createMockProviderKey(page, `mock-${suffix}`);
	const service = await createMockService(page, secretId);
	const tokenName = `gateway-${suffix}`;

	// issue the token through the dashboard, the way an operator would
	await page.goto('/app/tokens');
	await page.getByRole('button', { name: 'New token' }).click();
	const create = page.getByRole('dialog', { name: 'Create machine token' });
	await create.getByLabel('Token name').fill(tokenName);
	await create.getByRole('combobox').click();
	await page.getByPlaceholder('Search services…').fill(service.name);
	await page.getByRole('option', { name: service.name }).click();
	await expect(create.getByRole('combobox')).toHaveText(service.name);
	await create.getByRole('button', { name: 'Create token' }).click();

	// the reveal dialog's title depends on the instance's re-copy default
	const reveal = page.getByRole('dialog', { name: /^Token (created|secret)$/ });
	const secret = (await reveal.getByText(/^uprox_live_/).textContent())?.trim() ?? '';
	expect(secret).toMatch(/^uprox_live_/);
	await reveal.getByRole('button', { name: /^(Done|I've copied it)$/ }).click();
	await expect(reveal).toBeHidden();

	// buffered: the mock's completion comes back unchanged
	const prompt = `hello ${suffix}`;
	const res = await chat(request, secret, prompt);
	expect(res.status()).toBe(200);
	const body = (await res.json()) as {
		model: string;
		choices: { message: { content: string } }[];
		usage: { total_tokens: number };
	};
	expect(body.model).toBe(MOCK_MODEL);
	expect(body.choices[0]?.message.content).toBe(mockReply(prompt));
	expect(body.usage.total_tokens).toBe(19);

	// streamed: the SSE body is relayed chunk for chunk
	const streamed = await chat(request, secret, `${prompt} (stream)`, { stream: true });
	expect(streamed.status()).toBe(200);
	expect(streamed.headers()['content-type']).toContain('text/event-stream');
	const sse = await streamed.text();
	expect(sse).toContain(JSON.stringify(mockReply(`${prompt} (stream)`)));
	expect(sse).toContain('data: [DONE]');

	// both requests land in the audit log under the token, as successes
	const rows = await auditRows(page, { q: tokenName, kind: 'gateway' });
	await expect(rows).toHaveCount(2);
	for (const row of await rows.all()) {
		await expect(row).toContainText('Chat request');
		await expect(row).toContainText('ok 200');
		await expect(row).toContainText(tokenName);
		await expect(row).toContainText(service.name);
		await expect(row).toContainText('ollama');
		await expect(row).toContainText(MOCK_MODEL);
	}

	// and in the cost analysis, narrowed to this service; fresh=1 skips the
	// page's query cache, which may predate the traffic
	await page.goto(`/app/usage?range=last-24h&group=service&f=service:${service.id}&fresh=1`);
	await expect(page.getByRole('heading', { name: 'Cost analysis' })).toBeVisible();
	await expect(page.getByRole('link', { name: service.name, exact: true })).toBeVisible();
	await expect(page.locator('p:text-is("Requests") + p').first()).toHaveText('2');
});

test('the gateway rejects bad tokens and audits policy denials', async ({ page, request }) => {
	const suffix = uniqueSuffix();
	const secretId = await createMockProviderKey(page, `mock-${suffix}`);
	const service = await createMockService(page, secretId);

	// a working token first, so every denial below is down to the token alone
	const good = await createToken(page, { name: `ok-${suffix}`, serviceId: service.id });
	expect((await chat(request, good.token, 'baseline')).status()).toBe(200);

	// unknown token: rejected before any token or service is known, so not audited
	const unknown = await chat(request, 'uprox_live_notarealtokenatall', 'hi');
	expect(unknown.status()).toBe(401);
	expect(await unknown.json()).toMatchObject({ error: { type: 'authentication_error' } });

	// a missing header is the same 401
	const missing = await request.post('/v1/chat/completions', {
		data: { model: MOCK_MODEL, messages: [{ role: 'user', content: 'hi' }] }
	});
	expect(missing.status()).toBe(401);

	// revoked token: worked a moment ago, then stops at once
	const revoked = await createToken(page, { name: `revoked-${suffix}`, serviceId: service.id });
	expect((await chat(request, revoked.token, 'before revoke')).status()).toBe(200);
	const del = await page.request.delete(`/api/tokens/${revoked.id}`);
	expect(del.status()).toBe(200);
	const afterRevoke = await chat(request, revoked.token, 'after revoke');
	expect(afterRevoke.status()).toBe(401);
	expect(await afterRevoke.json()).toMatchObject({
		error: { message: 'Invalid or revoked API key' }
	});

	// endpoint access without chat
	const embedOnly = await createToken(page, {
		name: `denied-scope-${suffix}`,
		serviceId: service.id,
		scopes: ['embeddings', 'models']
	});
	const scopeDenied = await chat(request, embedOnly.token, 'hi');
	expect(scopeDenied.status()).toBe(403);
	expect(((await scopeDenied.json()) as { error: { message: string } }).error.message).toContain(
		'token is not scoped for "chat"'
	);

	// a model outside the token's allowlist
	const narrow = await createToken(page, {
		name: `denied-model-${suffix}`,
		serviceId: service.id,
		allowedModels: ['other-model-*']
	});
	const modelDenied = await chat(request, narrow.token, 'hi');
	expect(modelDenied.status()).toBe(403);
	expect(((await modelDenied.json()) as { error: { message: string } }).error.message).toContain(
		`model "${MOCK_MODEL}" is not allowed`
	);
	// the allowlist admits matching names, so the denial is about the model only
	expect((await chat(request, narrow.token, 'hi', { model: 'other-model-1' })).status()).toBe(200);

	// Each policy denial is in the audit log, found by its token under the
	// "Denied" filter. The table doesn't print the token on policy.deny rows, so
	// the search (which does match token names server-side) pins the row down.
	for (const [token, reason] of [
		[embedOnly.name, 'token is not scoped for "chat"'],
		[narrow.name, `model "${MOCK_MODEL}" is not allowed`]
	] as const) {
		const rows = await auditRows(page, { q: token, status: 'denied' });
		await expect(rows).toHaveCount(1);
		await expect(rows).toContainText('Denied by preset');
		await expect(rows).toContainText('deny 403');
		await expect(rows).toContainText(service.name);
		await expect(rows).toContainText(MOCK_MODEL);
		await expect(rows).toContainText(reason);
	}

	// all of this service's denials, and none of its successful calls
	const denied = await auditRows(page, { q: service.name, status: 'denied' });
	await expect(denied).toHaveCount(2);
	await expect(denied.filter({ hasText: 'ok 200' })).toHaveCount(0);
});
