import { test, expect } from '@playwright/test';
import { signInAdmin, uniqueSuffix } from './helpers';

/**
 * The admin REST API under /api: strict body validation and a uniform
 * `{ error, field? }` error shape (docs/API.md). Requests go through
 * `page.request`, which carries the browser context's session cookie.
 */
test.describe('admin API validation', () => {
	test.beforeEach(async ({ page }) => {
		await signInAdmin(page);
	});

	test('invalid JSON is a 400 with an error message', async ({ page }) => {
		for (const [method, url] of [
			['post', '/api/policies'],
			['post', '/api/services'],
			['post', '/api/tokens']
		] as const) {
			const res = await page.request[method](url, {
				data: '{"name": ',
				headers: { 'content-type': 'application/json' }
			});
			expect(res.status(), url).toBe(400);
			const body = await res.json();
			expect(typeof body.error, url).toBe('string');
			expect(body.error.length, url).toBeGreaterThan(0);
		}

		// a JSON value that is not an object is rejected the same way
		const arr = await page.request.post('/api/policies', { data: [1, 2, 3] });
		expect(arr.status()).toBe(400);
		expect(typeof (await arr.json()).error).toBe('string');
	});

	test('a field error names the offending field', async ({ page }) => {
		const res = await page.request.post('/api/policies', {
			data: { name: `bad-${uniqueSuffix()}`, rateLimitPerMinute: -1 }
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.field).toBe('rateLimitPerMinute');
		expect(typeof body.error).toBe('string');
	});

	test('a malformed id in the path is a 404', async ({ page }) => {
		const patch = await page.request.patch('/api/policies/not-a-uuid', {
			data: { name: 'whatever' }
		});
		expect(patch.status()).toBe(404);
		expect(typeof (await patch.json()).error).toBe('string');

		for (const url of ['/api/services/123', '/api/tokens/nope', '/api/pricing/x']) {
			const del = await page.request.delete(url);
			expect(del.status(), url).toBe(404);
			expect(typeof (await del.json()).error, url).toBe('string');
		}
	});

	test('PATCH ignores read-only id and createdAt', async ({ page }) => {
		const created = await page.request.post('/api/policies', {
			data: { name: `readonly-${uniqueSuffix()}` }
		});
		expect(created.status()).toBe(201);
		const policy = await created.json();

		const renamed = `renamed-${uniqueSuffix()}`;
		const res = await page.request.patch(`/api/policies/${policy.id}`, {
			data: {
				name: renamed,
				id: '00000000-0000-4000-8000-000000000000',
				createdAt: '2000-01-01T00:00:00.000Z'
			}
		});
		expect(res.status()).toBe(200);
		const updated = await res.json();
		expect(updated.name).toBe(renamed);
		expect(updated.id).toBe(policy.id);
		expect(updated.createdAt).toBe(policy.createdAt);

		// and the stored row agrees
		const list = (await (await page.request.get('/api/policies')).json()) as {
			id: string;
			name: string;
			createdAt: string;
		}[];
		const stored = list.find((p) => p.id === policy.id);
		expect(stored?.name).toBe(renamed);
		expect(stored?.createdAt).toBe(policy.createdAt);
		expect(list.some((p) => p.id === '00000000-0000-4000-8000-000000000000')).toBe(false);

		// a PATCH with only read-only fields has nothing to update
		const empty = await page.request.patch(`/api/policies/${policy.id}`, {
			data: { id: policy.id, createdAt: policy.createdAt }
		});
		expect(empty.status()).toBe(400);
		expect(typeof (await empty.json()).error).toBe('string');
	});

	test('POST /api/tokens never returns secret columns', async ({ page }) => {
		const res = await page.request.post('/api/tokens', {
			data: { name: `api-token-${uniqueSuffix()}` }
		});
		expect(res.status()).toBe(201);
		const token = await res.json();
		expect(token.token).toMatch(/^uprox_live_/);
		expect(token).not.toHaveProperty('hashedToken');
		expect(token).not.toHaveProperty('encryptedToken');
		expect(typeof token.recopyable).toBe('boolean');

		const list = (await (await page.request.get('/api/tokens')).json()) as Record<
			string,
			unknown
		>[];
		const listed = list.find((t) => t.id === token.id);
		expect(listed).toBeTruthy();
		expect(listed).not.toHaveProperty('hashedToken');
		expect(listed).not.toHaveProperty('encryptedToken');
		expect(listed).not.toHaveProperty('token');
	});

	test('an unknown serviceId is a 400 naming the field', async ({ page }) => {
		const res = await page.request.post('/api/tokens', {
			data: { name: `orphan-${uniqueSuffix()}`, serviceId: '00000000-0000-4000-8000-000000000000' }
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).field).toBe('serviceId');
	});
});
