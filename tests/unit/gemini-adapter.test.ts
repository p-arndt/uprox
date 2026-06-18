import { describe, it, expect } from 'vitest';
import {
	geminiAdapter,
	toGeminiChatRequest,
	toGeminiEmbedRequest,
	fromGeminiChatResponse,
	fromGeminiEmbedResponse,
	mapFinishReason,
	mapUsage,
	streamGeminiToOpenAi,
	parseGeminiAction
} from '$lib/server/adapters/gemini';

/** Build a ReadableStream<Uint8Array> from string chunks (a fake upstream SSE). */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
			else controller.close();
		}
	});
}

/** Drain an OpenAI SSE stream into the parsed `data:` objects + whether [DONE] was seen. */
async function readSse(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
	}
	const events = buf
		.split('\n\n')
		.map((b) => b.trim())
		.filter(Boolean)
		.map((b) => b.replace(/^data: /, ''));
	const done = events.includes('[DONE]');
	const objects = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e));
	return { objects, done };
}

describe('toGeminiChatRequest', () => {
	it('maps system to systemInstruction and assistant to the model role', () => {
		const req = toGeminiChatRequest({
			messages: [
				{ role: 'system', content: 'Be terse.' },
				{ role: 'user', content: 'Hi' },
				{ role: 'assistant', content: 'Hello' },
				{ role: 'user', content: 'Bye' }
			]
		});
		expect(req.systemInstruction).toEqual({ parts: [{ text: 'Be terse.' }] });
		expect(req.contents).toEqual([
			{ role: 'user', parts: [{ text: 'Hi' }] },
			{ role: 'model', parts: [{ text: 'Hello' }] },
			{ role: 'user', parts: [{ text: 'Bye' }] }
		]);
	});

	it('maps sampling params into generationConfig', () => {
		const req = toGeminiChatRequest({
			messages: [{ role: 'user', content: 'x' }],
			temperature: 0.2,
			top_p: 0.9,
			max_tokens: 256,
			stop: ['END'],
			n: 2,
			response_format: { type: 'json_object' }
		});
		expect(req.generationConfig).toEqual({
			temperature: 0.2,
			topP: 0.9,
			maxOutputTokens: 256,
			stopSequences: ['END'],
			candidateCount: 2,
			responseMimeType: 'application/json'
		});
	});

	it('translates OpenAI tools and tool_choice', () => {
		const req = toGeminiChatRequest({
			messages: [{ role: 'user', content: 'weather?' }],
			tools: [
				{
					type: 'function',
					function: {
						name: 'get_weather',
						description: 'Get weather',
						parameters: { type: 'object', properties: { city: { type: 'string' } } }
					}
				}
			],
			tool_choice: 'required'
		});
		expect(req.tools).toEqual([
			{
				functionDeclarations: [
					{
						name: 'get_weather',
						description: 'Get weather',
						parameters: { type: 'object', properties: { city: { type: 'string' } } }
					}
				]
			}
		]);
		expect(req.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
	});

	it('round-trips a tool call: assistant tool_calls and the tool result', () => {
		const req = toGeminiChatRequest({
			messages: [
				{ role: 'user', content: 'weather in SF?' },
				{
					role: 'assistant',
					content: null,
					tool_calls: [
						{
							id: 'call_abc',
							type: 'function',
							function: { name: 'get_weather', arguments: '{"city":"SF"}' }
						}
					]
				},
				{ role: 'tool', tool_call_id: 'call_abc', content: '{"tempC":18}' }
			]
		});
		expect(req.contents).toEqual([
			{ role: 'user', parts: [{ text: 'weather in SF?' }] },
			{ role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] },
			// the tool result is matched back to its function name via tool_call_id
			{
				role: 'user',
				parts: [{ functionResponse: { name: 'get_weather', response: { tempC: 18 } } }]
			}
		]);
	});

	it('converts a data-URI image part to inlineData', () => {
		const req = toGeminiChatRequest({
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'what is this?' },
						{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAB' } }
					]
				}
			]
		});
		expect(req.contents).toEqual([
			{
				role: 'user',
				parts: [{ text: 'what is this?' }, { inlineData: { mimeType: 'image/png', data: 'AAAB' } }]
			}
		]);
	});
});

describe('toGeminiEmbedRequest', () => {
	it('wraps a single string input as one batch request', () => {
		expect(toGeminiEmbedRequest({ input: 'hello' }, 'gemini-embedding-001')).toEqual({
			requests: [{ model: 'models/gemini-embedding-001', content: { parts: [{ text: 'hello' }] } }]
		});
	});

	it('maps an array input and dimensions to outputDimensionality', () => {
		const req = toGeminiEmbedRequest(
			{ input: ['a', 'b'], dimensions: 768 },
			'gemini-embedding-001'
		) as { requests: unknown[] };
		expect(req.requests).toEqual([
			{
				model: 'models/gemini-embedding-001',
				content: { parts: [{ text: 'a' }] },
				outputDimensionality: 768
			},
			{
				model: 'models/gemini-embedding-001',
				content: { parts: [{ text: 'b' }] },
				outputDimensionality: 768
			}
		]);
	});
});

describe('fromGeminiChatResponse', () => {
	it('maps a text candidate to an OpenAI choice with usage', () => {
		const out = fromGeminiChatResponse('gemini-2.5-flash', {
			candidates: [
				{
					content: { role: 'model', parts: [{ text: 'Hi there' }] },
					finishReason: 'STOP',
					index: 0
				}
			],
			usageMetadata: {
				promptTokenCount: 10,
				candidatesTokenCount: 4,
				thoughtsTokenCount: 2,
				cachedContentTokenCount: 6,
				totalTokenCount: 16
			}
		}) as Record<string, unknown>;
		expect(out.object).toBe('chat.completion');
		expect(out.model).toBe('gemini-2.5-flash');
		expect(out.choices).toEqual([
			{ index: 0, message: { role: 'assistant', content: 'Hi there' }, finish_reason: 'stop' }
		]);
		// thoughts fold into completion tokens; cached is a subset of prompt
		expect(out.usage).toEqual({
			prompt_tokens: 10,
			completion_tokens: 6,
			total_tokens: 16,
			prompt_tokens_details: { cached_tokens: 6 }
		});
	});

	it('maps a functionCall candidate to tool_calls with finish_reason tool_calls', () => {
		const out = fromGeminiChatResponse('gemini-2.5-pro', {
			candidates: [
				{
					content: {
						role: 'model',
						parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }]
					},
					finishReason: 'STOP',
					index: 0
				}
			]
		}) as { choices: { message: Record<string, unknown>; finish_reason: string }[] };
		const choice = out.choices[0];
		expect(choice.finish_reason).toBe('tool_calls');
		expect(choice.message.content).toBeNull();
		expect(choice.message.tool_calls).toEqual([
			{
				id: 'call_0',
				type: 'function',
				function: { name: 'get_weather', arguments: '{"city":"SF"}' }
			}
		]);
	});
});

describe('mapFinishReason / mapUsage', () => {
	it('maps Gemini finish reasons to OpenAI finish reasons', () => {
		expect(mapFinishReason('STOP', false)).toBe('stop');
		expect(mapFinishReason('MAX_TOKENS', false)).toBe('length');
		expect(mapFinishReason('SAFETY', false)).toBe('content_filter');
		expect(mapFinishReason('STOP', true)).toBe('tool_calls');
		expect(mapFinishReason(undefined, false)).toBeNull();
	});

	it('returns undefined usage when there is no usageMetadata', () => {
		expect(mapUsage(undefined)).toBeUndefined();
	});
});

describe('fromGeminiEmbedResponse', () => {
	it('maps batch embeddings to the OpenAI list shape', () => {
		const out = fromGeminiEmbedResponse('gemini-embedding-001', {
			embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
			usageMetadata: { promptTokenCount: 7 }
		});
		expect(out).toEqual({
			object: 'list',
			model: 'gemini-embedding-001',
			data: [
				{ object: 'embedding', index: 0, embedding: [0.1, 0.2] },
				{ object: 'embedding', index: 1, embedding: [0.3, 0.4] }
			],
			usage: { prompt_tokens: 7, total_tokens: 7 }
		});
	});
});

describe('geminiAdapter.buildUrl / translateModels', () => {
	const base = 'https://generativelanguage.googleapis.com/v1beta';

	it('builds native generateContent / stream / embed URLs', () => {
		expect(
			geminiAdapter.buildUrl({
				baseUrl: base,
				scope: 'chat',
				model: 'gemini-2.5-flash',
				stream: false
			})
		).toBe(`${base}/models/gemini-2.5-flash:generateContent`);
		expect(
			geminiAdapter.buildUrl({
				baseUrl: base,
				scope: 'chat',
				model: 'gemini-2.5-flash',
				stream: true
			})
		).toBe(`${base}/models/gemini-2.5-flash:streamGenerateContent?alt=sse`);
		expect(
			geminiAdapter.buildUrl({
				baseUrl: base,
				scope: 'embeddings',
				model: 'gemini-embedding-001',
				stream: false
			})
		).toBe(`${base}/models/gemini-embedding-001:batchEmbedContents`);
	});

	it('strips the models/ prefix from the native model list', () => {
		const text = JSON.stringify({
			models: [
				{ name: 'models/gemini-2.5-flash' },
				{ name: 'models/gemini-embedding-001' },
				{ notName: true }
			]
		});
		expect(geminiAdapter.translateModels(text)).toEqual([
			{ id: 'gemini-2.5-flash' },
			{ id: 'gemini-embedding-001' }
		]);
	});

	it('wraps a native error body in an OpenAI error envelope', () => {
		const text = JSON.stringify({
			error: { code: 400, message: 'bad key', status: 'INVALID_ARGUMENT' }
		});
		const out = JSON.parse(
			geminiAdapter.translateResponse({ scope: 'chat', model: 'm', text, ok: false })
		);
		expect(out).toEqual({
			error: { message: 'bad key', type: 'api_error', code: null, param: null }
		});
	});
});

describe('parseGeminiAction (native ingress)', () => {
	it('maps the four supported methods to scope + stream', () => {
		expect(parseGeminiAction('gemini-2.5-flash:generateContent')).toEqual({
			model: 'gemini-2.5-flash',
			method: 'generateContent',
			scope: 'chat',
			stream: false
		});
		expect(parseGeminiAction('gemini-2.5-flash:streamGenerateContent')).toEqual({
			model: 'gemini-2.5-flash',
			method: 'streamGenerateContent',
			scope: 'chat',
			stream: true
		});
		expect(parseGeminiAction('gemini-embedding-001:embedContent')).toEqual({
			model: 'gemini-embedding-001',
			method: 'embedContent',
			scope: 'embeddings',
			stream: false
		});
		expect(parseGeminiAction('gemini-embedding-001:batchEmbedContents')?.scope).toBe('embeddings');
	});

	it('treats countTokens as a (free) chat-scope action', () => {
		expect(parseGeminiAction('gemini-2.5-flash:countTokens')).toEqual({
			model: 'gemini-2.5-flash',
			method: 'countTokens',
			scope: 'chat',
			stream: false
		});
	});

	it('returns null for an unsupported method or a malformed segment', () => {
		expect(parseGeminiAction('gemini-2.5-flash:embedText')).toBeNull();
		expect(parseGeminiAction('gemini-2.5-flash')).toBeNull();
		expect(parseGeminiAction(':generateContent')).toBeNull();
	});
});

describe('streamGeminiToOpenAi', () => {
	it('translates native SSE into OpenAI chunks with a role, content, finish and usage', async () => {
		const source = streamOf([
			'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"index":0}]}\n\n',
			'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}\n\n'
		]);
		const { objects, done } = await readSse(streamGeminiToOpenAi('gemini-2.5-flash', source));
		expect(done).toBe(true);
		// first content delta carries the assistant role
		expect(objects[0].choices[0].delta).toEqual({ role: 'assistant', content: 'Hello' });
		expect(objects[1].choices[0].delta).toEqual({ content: ' world' });
		// a finish chunk, then a usage-only chunk with empty choices
		expect(objects[2].choices[0].finish_reason).toBe('stop');
		const usageChunk = objects[objects.length - 1];
		expect(usageChunk.choices).toEqual([]);
		expect(usageChunk.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
		// every chunk is a chat.completion.chunk with a stable id
		expect(new Set(objects.map((o) => o.id)).size).toBe(1);
		expect(objects.every((o) => o.object === 'chat.completion.chunk')).toBe(true);
	});

	it('handles native SSE split across read boundaries', async () => {
		// one logical event delivered in three byte-chunks
		const source = streamOf([
			'data: {"candidates":[{"content":{"role":"model","par',
			'ts":[{"text":"Hi"}]},"finishReason":"STOP","index":0}],',
			'"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n'
		]);
		const { objects, done } = await readSse(streamGeminiToOpenAi('gemini-2.5-flash', source));
		expect(done).toBe(true);
		expect(objects[0].choices[0].delta).toEqual({ role: 'assistant', content: 'Hi' });
		expect(objects.some((o) => o.choices[0]?.finish_reason === 'stop')).toBe(true);
	});

	it('emits a single tool_call delta for a streamed functionCall', async () => {
		const source = streamOf([
			'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"get_weather","args":{"city":"SF"}}}]},"finishReason":"STOP","index":0}]}\n\n'
		]);
		const { objects } = await readSse(streamGeminiToOpenAi('gemini-2.5-pro', source));
		const toolDelta = objects[0].choices[0].delta;
		expect(toolDelta.role).toBe('assistant');
		expect(toolDelta.tool_calls).toEqual([
			{
				index: 0,
				id: 'call_0',
				type: 'function',
				function: { name: 'get_weather', arguments: '{"city":"SF"}' }
			}
		]);
		expect(objects.some((o) => o.choices[0]?.finish_reason === 'tool_calls')).toBe(true);
	});
});
