/**
 * Characterization tests for the billable pipelines (`proxyToProvider`,
 * `proxyGeminiNative`) and native Gemini model discovery (`proxyGeminiModels`).
 * The stage modules (routing, guards, upstream I/O, recording) are mocked so the
 * tests pin exactly which stages run, with which arguments, and what the client
 * gets back on every branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { ResolvedToken } from '$lib/server/tokens';
import { PROVIDERS } from '$lib/server/providers';
import { cacheKeyFor } from '$lib/server/cache';
import { toGeminiChatRequest } from '$lib/server/adapters/gemini';

vi.mock('$lib/server/gateway/resolve-provider', () => ({ resolveRoutedProvider: vi.fn() }));
vi.mock('$lib/server/gateway/guards', () => ({
	checkAccess: vi.fn(),
	replayCached: vi.fn(),
	acquireUpstream: vi.fn()
}));
vi.mock('$lib/server/gateway/upstream', () => ({
	fetchUpstream: vi.fn(),
	readUpstreamText: vi.fn()
}));
vi.mock('$lib/server/gateway/stream', () => ({ streamWithRecording: vi.fn() }));
vi.mock('$lib/server/gateway/record-usage', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/gateway/record-usage')>()),
	recordCompletion: vi.fn()
}));
vi.mock('$lib/server/gateway/credentials', () => ({
	loadProviderCreds: vi.fn(),
	loadConfiguredProviders: vi.fn()
}));
vi.mock('$lib/server/policy', () => ({ evaluatePolicy: vi.fn() }));
vi.mock('$lib/server/audit', () => ({ audit: vi.fn() }));

const { resolveRoutedProvider } = await import('$lib/server/gateway/resolve-provider');
const { checkAccess, replayCached, acquireUpstream } = await import('$lib/server/gateway/guards');
const { fetchUpstream, readUpstreamText } = await import('$lib/server/gateway/upstream');
const { streamWithRecording } = await import('$lib/server/gateway/stream');
const {
	recordCompletion,
	openAiUsageExtractor,
	geminiUsageExtractor,
	usageFromText,
	bufferedOpenAiUsageExtractor,
	geminiNativeUsage
} = await import('$lib/server/gateway/record-usage');
const { loadProviderCreds } = await import('$lib/server/gateway/credentials');
const { evaluatePolicy } = await import('$lib/server/policy');
const { audit } = await import('$lib/server/audit');
const { proxyToProvider, proxyGeminiNative } = await import('$lib/server/gateway/pipeline');
const { proxyGeminiModels } = await import('$lib/server/gateway/passthrough');
const { openAiEnvelope, geminiEnvelope, geminiNativeError } =
	await import('$lib/server/gateway/envelope');

const openai = PROVIDERS.openai;
const gemini = PROVIDERS.gemini;

function makeToken(overrides: Partial<ResolvedToken['effective']> = {}): ResolvedToken {
	return {
		tokenId: 'tok-1',
		serviceId: 'svc-1',
		serviceName: 'Service',
		scopes: [],
		providerSecretId: 'secret-1',
		effective: {
			cacheTtlSeconds: 60,
			tracingEnabled: false,
			preferredProvider: null,
			...overrides
		} as ResolvedToken['effective']
	};
}

function makeEvent(url: string, headers: Record<string, string> = {}): RequestEvent {
	return { request: new Request(url, { headers }), url: new URL(url) } as unknown as RequestEvent;
}

function makeGrant() {
	return { apiKey: 'up-key', baseUrl: 'https://upstream.test/v1', release: vi.fn() };
}

const streamResponse = new Response('streamed');
let grant: ReturnType<typeof makeGrant>;

beforeEach(() => {
	vi.clearAllMocks();
	grant = makeGrant();
	vi.mocked(resolveRoutedProvider).mockResolvedValue(openai);
	vi.mocked(checkAccess).mockResolvedValue(null);
	vi.mocked(replayCached).mockResolvedValue(null);
	vi.mocked(acquireUpstream).mockResolvedValue(grant);
	vi.mocked(streamWithRecording).mockReturnValue(streamResponse);
	vi.mocked(recordCompletion).mockResolvedValue(undefined);
});

/** Make the upstream fetch succeed with this response and buffered text. */
function upstreamReturns(upstream: Response, text: string) {
	vi.mocked(fetchUpstream).mockResolvedValue({ ok: true, upstream });
	vi.mocked(readUpstreamText).mockResolvedValue(text);
}

function ctxArg(mock: { mock: { calls: unknown[][] } }) {
	return mock.mock.calls[0][0] as Record<string, unknown>;
}

/* -------------------------------- proxyToProvider -------------------------------- */

describe('characterization — proxyToProvider', () => {
	const chatBody = { model: 'gpt-4o', temperature: 0, messages: [] };
	const auth = { token: makeToken(), ip: '10.0.0.1' };
	const opts = (o: Partial<Parameters<typeof proxyToProvider>[1]> = {}) => ({
		auth,
		scope: 'chat' as const,
		model: 'gpt-4o',
		path: '/chat/completions',
		body: chatBody,
		stream: false,
		...o
	});
	const event = () => makeEvent('https://gw.test/v1/chat/completions');

	it('returns the routing rejection before any other stage', async () => {
		const rejection = new Response('no route', { status: 400 });
		vi.mocked(resolveRoutedProvider).mockResolvedValue(rejection);
		const ev = event();
		expect(await proxyToProvider(ev, opts({ preferProvider: 'azure' }))).toBe(rejection);
		const ctx = ctxArg(vi.mocked(resolveRoutedProvider));
		expect(ctx).toMatchObject({
			event: ev,
			token: auth.token,
			ip: '10.0.0.1',
			scope: 'chat',
			model: 'gpt-4o',
			envelope: openAiEnvelope
		});
		expect(vi.mocked(resolveRoutedProvider).mock.calls[0][1]).toBe('azure');
		expect(checkAccess).not.toHaveBeenCalled();
	});

	it('returns an access denial before touching the cache or budget', async () => {
		const denied = new Response('denied', { status: 403 });
		vi.mocked(checkAccess).mockResolvedValue(denied);
		expect(await proxyToProvider(event(), opts())).toBe(denied);
		expect(vi.mocked(checkAccess).mock.calls[0][1]).toBe(openai);
		expect(replayCached).not.toHaveBeenCalled();
		expect(acquireUpstream).not.toHaveBeenCalled();
	});

	it('replays a cache hit for a deterministic request without acquiring upstream', async () => {
		const hit = new Response('cached');
		vi.mocked(replayCached).mockResolvedValue(hit);
		expect(await proxyToProvider(event(), opts({ stream: true }))).toBe(hit);
		const [, provider, key, stream, ...rest] = vi.mocked(replayCached).mock.calls[0];
		expect(provider).toBe(openai);
		expect(key).toBe(cacheKeyFor('openai', '/chat/completions', chatBody, 'secret-1'));
		expect(stream).toBe(true);
		expect(rest).toEqual([]);
		expect(acquireUpstream).not.toHaveBeenCalled();
	});

	it.each([
		['a zero cache TTL', { auth: { token: makeToken({ cacheTtlSeconds: 0 }), ip: 'ip' } }],
		['a non-deterministic chat', { body: { model: 'gpt-4o', temperature: 1 } }],
		[
			'a Responses call with store:false',
			{ scope: 'responses' as const, body: { model: 'gpt-4o', seed: 1, store: false } }
		],
		['an uncacheable scope', { scope: 'images' as const, body: { model: 'gpt-image-1' } }]
	])('skips the cache for %s', async (_label, o) => {
		upstreamReturns(new Response(null, { status: 200 }), '{}');
		const res = await proxyToProvider(event(), opts(o));
		expect(replayCached).not.toHaveBeenCalled();
		expect(vi.mocked(recordCompletion).mock.calls[0][1].cache).toBeNull();
		expect(res.headers.get('x-uprox-cache')).toBeNull();
	});

	it('caches deterministic embeddings and Responses calls', async () => {
		upstreamReturns(new Response(null, { status: 200 }), '{}');
		await proxyToProvider(
			event(),
			opts({ scope: 'embeddings', path: '/embeddings', body: { input: 'x' } })
		);
		await proxyToProvider(
			event(),
			opts({ scope: 'responses', path: '/responses', body: { seed: 3, store: true } })
		);
		expect(vi.mocked(replayCached).mock.calls.map((c) => c[2])).toEqual([
			cacheKeyFor('openai', '/embeddings', { input: 'x' }, 'secret-1'),
			cacheKeyFor('openai', '/responses', { seed: 3, store: true }, 'secret-1')
		]);
	});

	it('returns a budget/credential rejection from acquireUpstream', async () => {
		const rejection = new Response('402', { status: 402 });
		vi.mocked(acquireUpstream).mockResolvedValue(rejection);
		expect(await proxyToProvider(event(), opts())).toBe(rejection);
		expect(vi.mocked(acquireUpstream).mock.calls[0][1]).toBe(openai);
		expect(fetchUpstream).not.toHaveBeenCalled();
	});

	it('proxies a buffered pass-through request and records it', async () => {
		const upstream = new Response(null, { status: 201 });
		const text = '{"usage":{"prompt_tokens":3,"completion_tokens":4}}';
		upstreamReturns(upstream, text);
		const ev = makeEvent('https://gw.test/v1/chat/completions', { 'openai-beta': 'assistants=v2' });

		const res = await proxyToProvider(ev, opts());

		const [, provider, g, url, init] = vi.mocked(fetchUpstream).mock.calls[0];
		expect([provider, g, url]).toEqual([
			openai,
			grant,
			'https://upstream.test/v1/chat/completions'
		]);
		expect(init).toEqual({
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'openai-beta': 'assistants=v2',
				authorization: 'Bearer up-key'
			},
			body: JSON.stringify(chatBody)
		});
		expect(vi.mocked(readUpstreamText).mock.calls[0].slice(1)).toEqual([openai, grant, upstream]);
		const cache = {
			key: cacheKeyFor('openai', '/chat/completions', chatBody, 'secret-1'),
			ttlSeconds: 60
		};
		expect(vi.mocked(recordCompletion).mock.calls[0][1]).toEqual({
			provider: openai,
			statusCode: 201,
			ok: true,
			usage: usageFromText(text, bufferedOpenAiUsageExtractor),
			response: text,
			format: 'json',
			cache,
			complete: true,
			release: grant.release
		});
		expect(res.status).toBe(201);
		expect(Object.fromEntries(res.headers)).toEqual({
			'content-type': 'application/json',
			'x-uprox-cache': 'MISS'
		});
		expect(await res.text()).toBe(text);
	});

	it('records an upstream error body with ok:false', async () => {
		upstreamReturns(new Response(null, { status: 500 }), 'boom');
		const res = await proxyToProvider(event(), opts({ body: { temperature: 1 } }));
		expect(vi.mocked(recordCompletion).mock.calls[0][1]).toMatchObject({
			statusCode: 500,
			ok: false,
			usage: null,
			cache: null
		});
		expect(res.status).toBe(500);
		expect(await res.text()).toBe('boom');
	});

	it('defaults the realtime beta header only when the client sent none', async () => {
		upstreamReturns(new Response(null, { status: 200 }), '{}');
		await proxyToProvider(event(), opts({ scope: 'realtime', path: '/realtime/sessions' }));
		await proxyToProvider(
			makeEvent('https://gw.test/x', { 'openai-beta': 'realtime=v2' }),
			opts({ scope: 'realtime', path: '/realtime/sessions' })
		);
		await proxyToProvider(event(), opts());
		const headers = vi
			.mocked(fetchUpstream)
			.mock.calls.map((c) => (c[4].headers as Record<string, string>)['openai-beta']);
		expect(headers).toEqual(['realtime=v1', 'realtime=v2', undefined]);
	});

	it('returns the failure response when the upstream fetch fails', async () => {
		const failure = new Response('502', { status: 502 });
		vi.mocked(fetchUpstream).mockResolvedValue({ ok: false, response: failure });
		expect(await proxyToProvider(event(), opts())).toBe(failure);
		expect(readUpstreamText).not.toHaveBeenCalled();
		expect(recordCompletion).not.toHaveBeenCalled();
	});

	it('returns the failure response when reading the buffered body fails', async () => {
		const failure = new Response('502', { status: 502 });
		vi.mocked(fetchUpstream).mockResolvedValue({ ok: true, upstream: new Response(null) });
		vi.mocked(readUpstreamText).mockResolvedValue(failure);
		expect(await proxyToProvider(event(), opts())).toBe(failure);
		expect(recordCompletion).not.toHaveBeenCalled();
	});

	it('streams with a usage chunk request merged into caller stream_options', async () => {
		const upstream = new Response('data: {}\n\n', { status: 200 });
		upstreamReturns(upstream, '');
		const body = { model: 'gpt-4o', stream: true, stream_options: { foo: 1 } };
		const res = await proxyToProvider(event(), opts({ body, stream: true, wantsUsageChunk: true }));
		expect(res).toBe(streamResponse);
		expect(JSON.parse(vi.mocked(fetchUpstream).mock.calls[0][4].body as string)).toEqual({
			...body,
			stream_options: { foo: 1, include_usage: true }
		});
		expect(vi.mocked(streamWithRecording).mock.calls[0][1]).toEqual({
			provider: openai,
			upstream,
			source: upstream.body,
			extract: openAiUsageExtractor,
			cache: null,
			detail: 'stream',
			release: grant.release
		});
		expect(readUpstreamText).not.toHaveBeenCalled();
	});

	it('leaves the body alone without wantsUsageChunk or for a non-object body', async () => {
		upstreamReturns(new Response('data: {}\n\n'), '');
		await proxyToProvider(event(), opts({ body: { a: 1 }, stream: true }));
		await proxyToProvider(event(), opts({ body: 'raw', stream: true, wantsUsageChunk: true }));
		await proxyToProvider(event(), opts({ body: { a: 1 }, stream: false, wantsUsageChunk: true }));
		expect(vi.mocked(fetchUpstream).mock.calls.map((c) => c[4].body)).toEqual([
			'{"a":1}',
			'"raw"',
			'{"a":1}'
		]);
	});

	it('buffers a stream request whose upstream failed or has no body', async () => {
		upstreamReturns(new Response('err', { status: 429 }), 'err');
		const res = await proxyToProvider(event(), opts({ stream: true }));
		expect(streamWithRecording).not.toHaveBeenCalled();
		expect(res.status).toBe(429);

		vi.clearAllMocks();
		vi.mocked(resolveRoutedProvider).mockResolvedValue(openai);
		vi.mocked(acquireUpstream).mockResolvedValue(grant);
		upstreamReturns(new Response(null, { status: 200 }), '{}');
		await proxyToProvider(event(), opts({ stream: true }));
		expect(streamWithRecording).not.toHaveBeenCalled();
		expect(recordCompletion).toHaveBeenCalledTimes(1);
	});

	describe('with an adapter provider (Gemini)', () => {
		const geminiBody = { model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] };
		const gOpts = (o: Partial<Parameters<typeof proxyToProvider>[1]> = {}) =>
			opts({ model: 'gemini-2.5-flash', body: geminiBody, ...o });

		beforeEach(() => {
			vi.mocked(resolveRoutedProvider).mockResolvedValue(gemini);
		});

		it('builds the native URL, translates the body and skips OpenAI-only headers', async () => {
			const native = JSON.stringify({
				candidates: [{ content: { parts: [{ text: 'yo' }] }, finishReason: 'STOP' }],
				usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 }
			});
			upstreamReturns(new Response(null, { status: 200 }), native);
			const ev = makeEvent('https://gw.test/v1/chat/completions', { 'openai-beta': 'x' });
			const res = await proxyToProvider(ev, gOpts({ wantsUsageChunk: true }));

			const [, , , url, init] = vi.mocked(fetchUpstream).mock.calls[0];
			expect(url).toBe('https://upstream.test/v1/models/gemini-2.5-flash:generateContent');
			expect(init).toEqual({
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-goog-api-key': 'up-key' },
				body: JSON.stringify(toGeminiChatRequest(geminiBody))
			});
			const recorded = vi.mocked(recordCompletion).mock.calls[0][1];
			const translated = JSON.parse(recorded.response);
			expect(translated.object).toBe('chat.completion');
			expect(translated.choices[0].message).toEqual({ role: 'assistant', content: 'yo' });
			expect(recorded.usage).toEqual(
				usageFromText(recorded.response, bufferedOpenAiUsageExtractor)
			);
			expect(await res.text()).toBe(recorded.response);
		});

		it('translates an upstream error body into the OpenAI envelope', async () => {
			upstreamReturns(
				new Response(null, { status: 400 }),
				JSON.stringify({ error: { message: 'bad thing' } })
			);
			const res = await proxyToProvider(event(), gOpts());
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: { message: 'bad thing', type: 'api_error', code: null, param: null }
			});
		});

		it('streams through the adapter translator without adding stream_options', async () => {
			const upstream = new Response('data: {}\n\n', { status: 200 });
			upstreamReturns(upstream, '');
			await proxyToProvider(
				event(),
				gOpts({ stream: true, wantsUsageChunk: true, body: { ...geminiBody, stream: true } })
			);
			const [, , , url, init] = vi.mocked(fetchUpstream).mock.calls[0];
			expect(url).toBe(
				'https://upstream.test/v1/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
			);
			expect(JSON.parse(init.body as string)).not.toHaveProperty('stream_options');
			const recording = vi.mocked(streamWithRecording).mock.calls[0][1];
			expect(recording.source).toBeInstanceOf(ReadableStream);
			expect(recording.source).not.toBe(upstream.body);
			expect(recording.extract).toBe(openAiUsageExtractor);
			expect(recording.detail).toBe('stream');
		});
	});
});

/* ------------------------------- proxyGeminiNative ------------------------------- */

describe('characterization — proxyGeminiNative', () => {
	const auth = { token: makeToken(), ip: '10.0.0.2' };
	const body = { contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { temperature: 0 } };
	const opts = (o: Partial<Parameters<typeof proxyGeminiNative>[1]> = {}) => ({
		auth,
		scope: 'chat' as const,
		model: 'gemini-2.5-flash',
		method: 'generateContent',
		stream: false,
		body,
		...o
	});
	const event = (qs = '') => makeEvent(`https://gw.test/v1beta/models/x${qs}`);

	it('rejects an unsafe model name before any stage', async () => {
		const res = await proxyGeminiNative(event(), opts({ model: '../etc' }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual(
			await geminiEnvelope.error(400, 'Invalid model name', 'invalid_request').json()
		);
		expect(checkAccess).not.toHaveBeenCalled();
	});

	it('builds the context with the Gemini envelope and returns an access denial', async () => {
		const denied = new Response('denied', { status: 403 });
		vi.mocked(checkAccess).mockResolvedValue(denied);
		const ev = event();
		expect(await proxyGeminiNative(ev, opts())).toBe(denied);
		expect(ctxArg(vi.mocked(checkAccess))).toMatchObject({
			event: ev,
			token: auth.token,
			ip: '10.0.0.2',
			scope: 'chat',
			model: 'gemini-2.5-flash',
			envelope: geminiEnvelope
		});
		expect(vi.mocked(checkAccess).mock.calls[0][1]).toBe(gemini);
		expect(resolveRoutedProvider).not.toHaveBeenCalled();
	});

	it('lets an empty model through the name check', async () => {
		vi.mocked(checkAccess).mockResolvedValue(new Response('stop'));
		await proxyGeminiNative(event(), opts({ model: '' }));
		expect(checkAccess).toHaveBeenCalled();
	});

	it('replays a cache hit keyed on the native path with the native detail prefix', async () => {
		const hit = new Response('cached');
		vi.mocked(replayCached).mockResolvedValue(hit);
		expect(await proxyGeminiNative(event(), opts({ stream: true }))).toBe(hit);
		expect(vi.mocked(replayCached).mock.calls[0].slice(1)).toEqual([
			gemini,
			cacheKeyFor('gemini', '/models/gemini-2.5-flash:generateContent', body, 'secret-1'),
			true,
			'native '
		]);
		expect(acquireUpstream).not.toHaveBeenCalled();
	});

	it.each([
		['sampling not pinned', { body: { contents: [] } }],
		['a non-zero temperature', { body: { generationConfig: { temperature: 0.5 } } }],
		['a zero cache TTL', { auth: { token: makeToken({ cacheTtlSeconds: 0 }), ip: 'ip' } }],
		['a non-chat/embeddings scope', { scope: 'models' as const }]
	])('skips the cache for %s', async (_label, o) => {
		upstreamReturns(new Response(null), '{}');
		const res = await proxyGeminiNative(event(), opts(o));
		expect(replayCached).not.toHaveBeenCalled();
		expect(vi.mocked(recordCompletion).mock.calls[0][1].cache).toBeNull();
		expect(res.headers.get('x-uprox-cache')).toBeNull();
	});

	it('always caches embeddings', async () => {
		upstreamReturns(new Response(null), '{}');
		await proxyGeminiNative(
			event(),
			opts({ scope: 'embeddings', method: 'batchEmbedContents', body: { requests: [] } })
		);
		expect(vi.mocked(replayCached).mock.calls[0][2]).toBe(
			cacheKeyFor(
				'gemini',
				'/models/gemini-2.5-flash:batchEmbedContents',
				{ requests: [] },
				'secret-1'
			)
		);
	});

	it('returns an acquireUpstream rejection', async () => {
		const rejection = new Response('402', { status: 402 });
		vi.mocked(acquireUpstream).mockResolvedValue(rejection);
		expect(await proxyGeminiNative(event(), opts())).toBe(rejection);
		expect(vi.mocked(acquireUpstream).mock.calls[0][1]).toBe(gemini);
		expect(fetchUpstream).not.toHaveBeenCalled();
	});

	it('forwards the query string minus `key` and the body verbatim, then records usage', async () => {
		const upstream = new Response(null, {
			status: 200,
			headers: { 'content-type': 'application/json; charset=UTF-8' }
		});
		const text = JSON.stringify({ usageMetadata: { promptTokenCount: 4, totalTokenCount: 4 } });
		upstreamReturns(upstream, text);
		const res = await proxyGeminiNative(event('?key=uprox-token&alt=json&x=1'), opts());

		const [, provider, g, url, init] = vi.mocked(fetchUpstream).mock.calls[0];
		expect([provider, g]).toEqual([gemini, grant]);
		expect(url).toBe(
			'https://upstream.test/v1/models/gemini-2.5-flash:generateContent?alt=json&x=1'
		);
		expect(init).toEqual({
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-goog-api-key': 'up-key' },
			body: JSON.stringify(body)
		});
		expect(vi.mocked(recordCompletion).mock.calls[0][1]).toEqual({
			provider: gemini,
			statusCode: 200,
			ok: true,
			usage: usageFromText(text, geminiNativeUsage),
			response: text,
			format: 'json',
			detail: 'native',
			cache: {
				key: cacheKeyFor('gemini', '/models/gemini-2.5-flash:generateContent', body, 'secret-1'),
				ttlSeconds: 60
			},
			complete: true,
			release: grant.release
		});
		expect(Object.fromEntries(res.headers)).toEqual({
			'content-type': 'application/json; charset=UTF-8',
			'x-uprox-cache': 'MISS'
		});
		expect(await res.text()).toBe(text);
	});

	it('omits the query separator when only `key` was sent', async () => {
		upstreamReturns(new Response(null), '{}');
		await proxyGeminiNative(event('?key=uprox-token'), opts({ body: {} }));
		expect(vi.mocked(fetchUpstream).mock.calls[0][3]).toBe(
			'https://upstream.test/v1/models/gemini-2.5-flash:generateContent'
		);
	});

	it('defaults the buffered content-type and passes upstream errors through', async () => {
		const upstream = new Response(null, { status: 404 });
		upstream.headers.delete('content-type');
		upstreamReturns(upstream, 'nope');
		const res = await proxyGeminiNative(event(), opts({ body: {} }));
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(vi.mocked(recordCompletion).mock.calls[0][1]).toMatchObject({ ok: false, usage: null });
	});

	it('returns fetch and body-read failures as-is', async () => {
		const failure = new Response('502', { status: 502 });
		vi.mocked(fetchUpstream).mockResolvedValue({ ok: false, response: failure });
		expect(await proxyGeminiNative(event(), opts())).toBe(failure);

		vi.mocked(fetchUpstream).mockResolvedValue({ ok: true, upstream: new Response(null) });
		vi.mocked(readUpstreamText).mockResolvedValue(failure);
		expect(await proxyGeminiNative(event(), opts())).toBe(failure);
		expect(recordCompletion).not.toHaveBeenCalled();
	});

	it('streams the native SSE through untouched', async () => {
		const upstream = new Response('data: {}\n\n', { status: 200 });
		upstreamReturns(upstream, '');
		const res = await proxyGeminiNative(
			event('?alt=sse'),
			opts({ method: 'streamGenerateContent', stream: true })
		);
		expect(res).toBe(streamResponse);
		expect(vi.mocked(fetchUpstream).mock.calls[0][3]).toBe(
			'https://upstream.test/v1/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
		);
		expect(vi.mocked(streamWithRecording).mock.calls[0][1]).toEqual({
			provider: gemini,
			upstream,
			source: upstream.body,
			extract: geminiUsageExtractor,
			cache: {
				key: cacheKeyFor(
					'gemini',
					'/models/gemini-2.5-flash:streamGenerateContent',
					body,
					'secret-1'
				),
				ttlSeconds: 60
			},
			detail: 'native stream',
			release: grant.release
		});
	});
});

/* ------------------------------- proxyGeminiModels ------------------------------- */

describe('characterization — proxyGeminiModels', () => {
	const token = makeToken();
	const auth = { token, ip: '10.0.0.3' };
	const denied = new Set<string>();
	const fetchMock = vi.fn();

	beforeEach(() => {
		denied.clear();
		vi.mocked(evaluatePolicy).mockImplementation((_t, req) =>
			denied.has(req.model) ? { allow: false, reason: 'no' } : { allow: true }
		);
		vi.mocked(loadProviderCreds).mockResolvedValue({ apiKey: 'g-key', baseUrl: null } as never);
		vi.mocked(audit).mockResolvedValue('audit-id' as never);
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	const auditBase = {
		action: 'gateway.models',
		serviceId: 'svc-1',
		tokenId: 'tok-1',
		provider: 'gemini',
		ip: '10.0.0.3'
	};
	const notFound = async (model: string) =>
		geminiNativeError(404, `Model "${model}" is not available`, 'NOT_FOUND').json();
	const base = 'https://generativelanguage.googleapis.com/v1beta';

	it('returns an empty catalog when the provider is disallowed for a list call', async () => {
		denied.add('');
		const res = await proxyGeminiModels(makeEvent('https://gw.test/v1beta/models'), auth, null);
		expect(await res.json()).toEqual({ models: [] });
		expect(evaluatePolicy).toHaveBeenCalledWith(token, {
			provider: 'gemini',
			model: '',
			scope: 'models'
		});
		expect(loadProviderCreds).not.toHaveBeenCalled();
	});

	it('reports a forbidden or unsafe model as not found', async () => {
		denied.add('gemini-secret');
		const forbidden = await proxyGeminiModels(
			makeEvent('https://gw.test/x'),
			auth,
			'gemini-secret'
		);
		expect(forbidden.status).toBe(404);
		expect(await forbidden.json()).toEqual(await notFound('gemini-secret'));

		const unsafe = await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, 'a/b');
		expect(unsafe.status).toBe(404);
		expect(await unsafe.json()).toEqual(await notFound('a/b'));
		expect(loadProviderCreds).not.toHaveBeenCalled();
	});

	it('fails with FAILED_PRECONDITION when no credentials are configured', async () => {
		vi.mocked(loadProviderCreds).mockResolvedValue(null);
		const res = await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, null);
		expect(loadProviderCreds).toHaveBeenCalledWith('gemini', 'secret-1');
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual(
			await geminiNativeError(
				502,
				'No Google Gemini credentials configured for this instance',
				'FAILED_PRECONDITION'
			).json()
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('audits and returns UNAVAILABLE when the upstream fetch throws', async () => {
		fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
		const res = await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, 'gemini-2.5-pro');
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual(
			await geminiNativeError(502, 'Upstream provider request failed', 'UNAVAILABLE').json()
		);
		expect(audit).toHaveBeenCalledWith({
			...auditBase,
			status: 'error',
			model: 'gemini-2.5-pro',
			statusCode: 502,
			detail: 'socket hang up'
		});

		fetchMock.mockRejectedValueOnce('weird');
		await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, null);
		expect(audit).toHaveBeenLastCalledWith({
			...auditBase,
			status: 'error',
			model: undefined,
			statusCode: 502,
			detail: 'upstream fetch failed'
		});
	});

	it('passes an upstream error through with its status and content-type', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"error":{}}', { status: 403, headers: { 'content-type': 'text/x-err' } })
		);
		const res = await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, 'gemini-2.5-pro');
		expect(res.status).toBe(403);
		expect(res.headers.get('content-type')).toBe('text/x-err');
		expect(await res.text()).toBe('{"error":{}}');
		expect(audit).toHaveBeenCalledWith({
			...auditBase,
			status: 'error',
			model: 'gemini-2.5-pro',
			statusCode: 403,
			detail: 'get gemini-2.5-pro'
		});

		const bare = new Response('x', { status: 500 });
		bare.headers.delete('content-type');
		fetchMock.mockResolvedValueOnce(bare);
		const listRes = await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, null);
		expect(listRes.headers.get('content-type')).toBe('application/json');
		expect(audit).toHaveBeenLastCalledWith({
			...auditBase,
			status: 'error',
			model: undefined,
			statusCode: 500,
			detail: 'list'
		});
	});

	it('returns a single model as-is, forwarding the query minus `key`', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"name":"models/gemini-2.5-pro"}'));
		const ev = makeEvent('https://gw.test/v1beta/models/gemini-2.5-pro?key=tok&view=full');
		const res = await proxyGeminiModels(ev, auth, 'gemini-2.5-pro');
		expect(fetchMock).toHaveBeenCalledWith(`${base}/models/gemini-2.5-pro?view=full`, {
			headers: { 'x-goog-api-key': 'g-key' },
			signal: ev.request.signal
		});
		expect(res.status).toBe(200);
		expect(Object.fromEntries(res.headers)).toEqual({ 'content-type': 'application/json' });
		expect(await res.text()).toBe('{"name":"models/gemini-2.5-pro"}');
		expect(audit).toHaveBeenCalledWith({
			...auditBase,
			status: 'ok',
			model: 'gemini-2.5-pro',
			statusCode: 200,
			detail: 'get gemini-2.5-pro'
		});
	});

	it('filters the list by policy and keeps the page token', async () => {
		denied.add('gemini-hidden');
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					models: [
						{ name: 'models/gemini-2.5-pro' },
						{ name: 'models/gemini-hidden' },
						{ name: 'gemini-bare' },
						{ name: 'models/' },
						{ displayName: 'nameless' },
						'junk'
					],
					nextPageToken: 'page-2'
				})
			)
		);
		const res = await proxyGeminiModels(makeEvent('https://gw.test/v1beta/models'), auth, null);
		expect(fetchMock.mock.calls[0][0]).toBe(`${base}/models`);
		expect(await res.json()).toEqual({
			models: [{ name: 'models/gemini-2.5-pro' }, { name: 'gemini-bare' }],
			nextPageToken: 'page-2'
		});
		expect(audit).toHaveBeenCalledWith({
			...auditBase,
			status: 'ok',
			statusCode: 200,
			detail: '2 models'
		});
	});

	it('returns an empty list for an unparseable body or a non-string page token', async () => {
		fetchMock.mockResolvedValueOnce(new Response('not json'));
		const res = await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, null);
		expect(await res.json()).toEqual({ models: [] });

		fetchMock.mockResolvedValueOnce(new Response('{"models":"x","nextPageToken":5}'));
		const res2 = await proxyGeminiModels(makeEvent('https://gw.test/x'), auth, null);
		expect(await res2.json()).toEqual({ models: [] });
	});
});
