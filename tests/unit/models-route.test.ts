/** The OpenAI-compatible `/v1/models` route: upstream listing calls follow the client's abort signal. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const secrets = [
	{ provider: 'openai', baseUrl: null, encryptedSecret: 'sk-openai' },
	{ provider: 'gemini', baseUrl: null, encryptedSecret: 'g-key' }
];

vi.mock('$lib/server/db', () => ({
	db: { select: () => ({ from: async () => secrets }) }
}));
vi.mock('$lib/server/crypto', () => ({ decrypt: (s: string) => s }));
vi.mock('$lib/server/audit', () => ({ audit: vi.fn() }));
vi.mock('$lib/server/policy', () => ({ evaluatePolicy: () => ({ allow: true }) }));
vi.mock('$lib/server/gateway', () => ({
	authenticateGateway: async () => ({
		ok: true,
		auth: { token: { serviceId: 's', tokenId: 't' }, ip: '127.0.0.1' }
	})
}));

const { GET } = await import('../../src/routes/v1/models/+server');

describe('GET /v1/models', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	it('forwards the client abort signal to every upstream listing call', async () => {
		fetchMock.mockImplementation(async (url: string) =>
			url.includes('generativelanguage')
				? new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-pro' }] }))
				: new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }))
		);
		const request = new Request('https://gw.test/v1/models');
		const res = await GET({ request } as unknown as Parameters<typeof GET>[0] & RequestEvent);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init.signal).toBe(request.signal);
		}
		expect(await res.json()).toEqual({
			object: 'list',
			data: [
				{ id: 'gpt-4o', object: 'model', owned_by: 'openai' },
				{ id: 'gemini-2.5-pro', object: 'model', owned_by: 'gemini' }
			]
		});
	});
});
