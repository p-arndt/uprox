import { describe, it, expect, vi } from 'vitest';
import { PROVIDERS, type ProviderDef } from '$lib/server/providers';
import {
	connectionTestRequest,
	testProviderConnection,
	upstreamErrorMessage
} from '$lib/server/provider-connection';

describe('connectionTestRequest', () => {
	it('lists models on the static base URL with the provider auth header', () => {
		expect(connectionTestRequest(PROVIDERS.openai, 'sk-x', null)).toEqual({
			url: 'https://api.openai.com/v1/models',
			headers: { accept: 'application/json', authorization: 'Bearer sk-x' }
		});
	});

	it('uses the adapter model-listing URL and header for native Gemini', () => {
		const req = connectionTestRequest(PROVIDERS.gemini, 'AIza1', null);
		expect(req?.url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
		expect(req?.headers['x-goog-api-key']).toBe('AIza1');
	});

	it('normalizes an Azure endpoint and sends the api-key header', () => {
		const req = connectionTestRequest(PROVIDERS.azure, 'k', 'https://r.openai.azure.com/');
		expect(req?.url).toBe('https://r.openai.azure.com/openai/v1/models');
		expect(req?.headers['api-key']).toBe('k');
	});

	it('sends no auth header for Ollama without credentials', () => {
		const req = connectionTestRequest(PROVIDERS.ollama, '', 'http://gpu:11434');
		expect(req).toEqual({
			url: 'http://gpu:11434/v1/models',
			headers: { accept: 'application/json' }
		});
	});

	it('returns null without an endpoint or a model listing', () => {
		expect(connectionTestRequest(PROVIDERS.custom, 'k', null)).toBeNull();
		const noModels: ProviderDef = { ...PROVIDERS.openai, capabilities: ['chat'] };
		expect(connectionTestRequest(noModels, 'k', null)).toBeNull();
	});
});

describe('upstreamErrorMessage', () => {
	it('extracts the nested OpenAI-style message', () => {
		const body = JSON.stringify({ error: { message: 'Incorrect API key provided' } });
		expect(upstreamErrorMessage(401, 'Unauthorized', body)).toBe(
			'Upstream returned 401 Unauthorized: Incorrect API key provided'
		);
	});

	it('accepts a bare message or string error', () => {
		expect(upstreamErrorMessage(403, '', JSON.stringify({ message: 'nope' }))).toBe(
			'Upstream returned 403: nope'
		);
		expect(upstreamErrorMessage(400, '', JSON.stringify({ error: 'bad' }))).toBe(
			'Upstream returned 400: bad'
		);
	});

	it('drops HTML bodies and truncates long text', () => {
		expect(upstreamErrorMessage(502, 'Bad Gateway', '<html>oops</html>')).toBe(
			'Upstream returned 502 Bad Gateway'
		);
		const long = upstreamErrorMessage(500, '', 'x'.repeat(1000));
		expect(long.length).toBe(300);
		expect(long.endsWith('…')).toBe(true);
	});
});

describe('testProviderConnection', () => {
	it('reports ok on a 2xx and calls the model listing', async () => {
		const fetchMock = vi.fn(async () => new Response('{"data":[]}', { status: 200 }));
		const result = await testProviderConnection(PROVIDERS.anthropic, 'sk-ant', null, {
			fetch: fetchMock as unknown as typeof fetch
		});
		expect(result).toEqual({ status: 'ok' });
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.anthropic.com/v1/models',
			expect.objectContaining({ method: 'GET' })
		);
	});

	it('surfaces the upstream error on a non-2xx', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), {
					status: 401,
					statusText: 'Unauthorized'
				})
		);
		const result = await testProviderConnection(PROVIDERS.openai, 'bad', null, {
			fetch: fetchMock as unknown as typeof fetch
		});
		expect(result).toEqual({
			status: 'failed',
			message: 'Upstream returned 401 Unauthorized: invalid x-api-key'
		});
	});

	it('reports a timeout in seconds', async () => {
		const fetchMock = vi.fn(async () => {
			throw new DOMException('timed out', 'TimeoutError');
		});
		const result = await testProviderConnection(PROVIDERS.openai, 'k', null, {
			fetch: fetchMock as unknown as typeof fetch,
			timeoutMs: 2000
		});
		expect(result).toEqual({
			status: 'failed',
			message: 'No response from api.openai.com within 2s'
		});
	});

	it('reports an unreachable host with the underlying cause', async () => {
		const fetchMock = vi.fn(async () => {
			throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND nope') });
		});
		const result = await testProviderConnection(PROVIDERS.custom, 'k', 'https://nope.invalid/v1', {
			fetch: fetchMock as unknown as typeof fetch
		});
		expect(result).toEqual({
			status: 'failed',
			message: 'Could not reach nope.invalid: getaddrinfo ENOTFOUND nope'
		});
	});

	it('skips without fetching when the provider cannot be probed', async () => {
		const fetchMock = vi.fn();
		const result = await testProviderConnection(PROVIDERS.azure, 'k', null, {
			fetch: fetchMock as unknown as typeof fetch
		});
		expect(result.status).toBe('skipped');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
