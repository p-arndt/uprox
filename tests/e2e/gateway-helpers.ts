import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { MOCK_ENDPOINT, MOCK_MODEL, MOCK_PASSWORD, MOCK_USERNAME } from './mock-upstream';
import { uniqueSuffix } from './helpers';

/**
 * Store an Ollama key pointing at the mock upstream over the admin API and
 * return its id, so a service can pin it. The label keeps it apart from keys
 * other tests add to the same provider.
 */
export async function createMockProviderKey(page: Page, label: string): Promise<string> {
	const res = await page.request.post('/api/providers', {
		data: {
			provider: 'ollama',
			secret: `${MOCK_USERNAME}:${MOCK_PASSWORD}`,
			baseUrl: MOCK_ENDPOINT,
			label
		}
	});
	expect(res.status()).toBe(201);
	return ((await res.json()) as { id: string }).id;
}

/**
 * A service routed to the mock. Ollama claims any model name, but so do Azure
 * and the custom provider, which other specs may configure in the same
 * database: preferring Ollama and pinning the mock key makes routing
 * independent of them. A zero cache TTL keeps every call an upstream call.
 */
export async function createMockService(page: Page, providerSecretId: string, name?: string) {
	const res = await page.request.post('/api/services', {
		data: {
			name: name ?? `gateway-e2e-${uniqueSuffix()}`,
			providerSecretId,
			preferredProvider: 'ollama',
			cacheTtlSeconds: 0
		}
	});
	expect(res.status()).toBe(201);
	return (await res.json()) as { id: string; name: string };
}

/** Issue a machine token over the admin API; returns its id and one-time secret. */
export async function createToken(
	page: Page,
	data: { name: string; serviceId: string; scopes?: string[]; allowedModels?: string[] }
) {
	const res = await page.request.post('/api/tokens', { data });
	expect(res.status()).toBe(201);
	return (await res.json()) as { id: string; name: string; token: string };
}

/** One non-streaming chat completion through the gateway. */
export function chat(
	request: APIRequestContext,
	token: string,
	prompt: string,
	opts: { model?: string; stream?: boolean } = {}
) {
	return request.post('/v1/chat/completions', {
		headers: { authorization: `Bearer ${token}` },
		data: {
			model: opts.model ?? MOCK_MODEL,
			messages: [{ role: 'user', content: prompt }],
			...(opts.stream ? { stream: true } : {})
		}
	});
}
