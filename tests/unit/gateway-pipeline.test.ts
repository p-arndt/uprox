import { describe, it, expect } from 'vitest';
import { openAiEnvelope, geminiEnvelope } from '$lib/server/gateway';
import { multipartUpstreamUrl, v1Query } from '$lib/server/gateway/pipeline';
import { PROVIDERS } from '$lib/server/providers';

describe('error envelopes', () => {
	it('builds the OpenAI error shape with the mapped error type', async () => {
		const res = openAiEnvelope.error(403, 'Request denied by policy: nope', 'permission');
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			error: {
				message: 'Request denied by policy: nope',
				type: 'permission_error',
				code: null,
				param: null
			}
		});
	});

	it('builds the native Gemini error shape with the mapped Google status', async () => {
		const res = geminiEnvelope.error(502, 'No endpoint', 'upstream_misconfigured');
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: { code: 502, message: 'No endpoint', status: 'FAILED_PRECONDITION' }
		});
	});

	it('sets retry-after on rate-limited responses in both envelopes', async () => {
		const openai = openAiEnvelope.rateLimited(10, 7);
		expect(openai.status).toBe(429);
		expect(openai.headers.get('retry-after')).toBe('7');
		expect(openai.headers.get('content-type')).toContain('application/json');
		expect((await openai.json()).error.type).toBe('rate_limit_error');

		const gemini = geminiEnvelope.rateLimited(10, undefined);
		expect(gemini.status).toBe(429);
		expect(gemini.headers.get('retry-after')).toBe('1');
		expect(await gemini.json()).toEqual({
			error: {
				code: 429,
				message: 'Rate limit exceeded: 10 requests/min',
				status: 'RESOURCE_EXHAUSTED'
			}
		});
	});
});

describe('v1Query', () => {
	const q = (s: string) =>
		v1Query(new URL(`https://x/openai/deployments/d/audio/transcriptions${s}`));

	it('drops dated api-versions the v1 upstream rejects', () => {
		expect(q('?api-version=2025-03-01-preview')).toBe('');
		expect(q('?api-version=2024-10-21&foo=1')).toBe('?foo=1');
	});

	it('keeps v1-valid versions and other params', () => {
		expect(q('?api-version=preview')).toBe('?api-version=preview');
		expect(q('?limit=5')).toBe('?limit=5');
		expect(q('')).toBe('');
	});
});

describe('multipartUpstreamUrl', () => {
	const azure = 'https://res.openai.azure.com/openai/v1';
	const u = (qs = '') =>
		new URL(`https://gw/openai/deployments/gpt-4o-transcribe/audio/transcriptions${qs}`);

	it('sends Azure audio to the dated deployment route with the client version', () => {
		expect(
			multipartUpstreamUrl(
				PROVIDERS.azure,
				azure,
				'gpt-4o-transcribe',
				'/audio/transcriptions',
				u('?api-version=2025-04-01-preview')
			)
		).toBe(
			'https://res.openai.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-04-01-preview'
		);
	});

	it('defaults the version when the client sent none or a v1-only one', () => {
		for (const qs of ['', '?api-version=preview']) {
			expect(
				multipartUpstreamUrl(PROVIDERS.azure, azure, 'whisper', '/audio/transcriptions', u(qs))
			).toBe(
				'https://res.openai.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2025-03-01-preview'
			);
		}
	});

	it('rejects a model name unsafe for the URL path', () => {
		expect(
			multipartUpstreamUrl(PROVIDERS.azure, azure, '../x', '/audio/transcriptions', u())
		).toBeNull();
	});

	it('keeps non-audio Azure and other providers on the v1 base url', () => {
		expect(
			multipartUpstreamUrl(
				PROVIDERS.azure,
				azure,
				'gpt-image-1',
				'/images/edits',
				u('?api-version=2025-03-01-preview')
			)
		).toBe(`${azure}/images/edits`);
		expect(
			multipartUpstreamUrl(
				PROVIDERS.openai,
				'https://api.openai.com/v1',
				'whisper-1',
				'/audio/transcriptions',
				u()
			)
		).toBe('https://api.openai.com/v1/audio/transcriptions');
	});
});
