import { describe, it, expect } from 'vitest';
import { openAiEnvelope, geminiEnvelope } from '$lib/server/gateway';

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
