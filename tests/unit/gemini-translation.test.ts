/**
 * Characterization tests for the Gemini adapter's message translation
 * (`toContents`) and its SSE stream translator, pinning every branch before
 * those functions were split into per-role / per-part helpers.
 */
import { describe, it, expect, vi } from 'vitest';
import { toContents, streamGeminiToOpenAi } from '$lib/server/adapters/gemini';

describe('characterization — toContents', () => {
	it('collects system and developer text, skipping empty ones and non-record messages', () => {
		expect(
			toContents([
				null,
				'user',
				{ role: 'system', content: 'one' },
				{ role: 'developer', content: [{ type: 'text', text: 'tw' }, { text: 'o' }, 'x'] },
				{ role: 'system', content: '' },
				{ role: 'system', content: 42 }
			])
		).toEqual({ systemTexts: ['one', 'two'], contents: [] });
	});

	it('maps assistant text and tool calls, tolerating malformed calls and arguments', () => {
		const { contents } = toContents([
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'let me ' },
					{ type: 'text', text: 'check' }
				],
				tool_calls: [
					null,
					{ id: 'skip', type: 'function' },
					{ id: 'a', function: { name: 'good', arguments: '{"x":1}' } },
					{ id: 'b', function: { name: 'bad', arguments: '{not json' } },
					{ function: { name: 'empty', arguments: '' } },
					{ id: 3, function: { arguments: 5 } }
				]
			}
		]);
		expect(contents).toEqual([
			{
				role: 'model',
				parts: [
					{ text: 'let me check' },
					{ functionCall: { name: 'good', args: { x: 1 } } },
					{ functionCall: { name: 'bad', args: {} } },
					{ functionCall: { name: 'empty', args: {} } },
					{ functionCall: { name: '', args: {} } }
				]
			}
		]);
	});

	it('drops an assistant message with no text and no tool calls', () => {
		expect(
			toContents([
				{ role: 'assistant', content: '' },
				{ role: 'assistant', content: null, tool_calls: 'nope' }
			]).contents
		).toEqual([]);
	});

	it('names tool results from prior tool calls, then msg.name, then the id, then "function"', () => {
		const { contents } = toContents([
			{
				role: 'assistant',
				tool_calls: [
					{ id: 'c1', function: { name: 'lookup', arguments: '{}' } },
					{ id: 'c2', function: { arguments: '{}' } }
				]
			},
			{ role: 'tool', tool_call_id: 'c1', name: 'ignored', content: '{"ok":true}' },
			// mapped to an empty name, so msg.name wins
			{ role: 'tool', tool_call_id: 'c2', name: 'named', content: '[1,2]' },
			{ role: 'tool', tool_call_id: 'unknown', content: '5' },
			{ role: 'tool', content: 'plain text' },
			{ role: 'tool', tool_call_id: 7, content: [{ type: 'text', text: 'null' }] }
		]);
		expect(contents.slice(1)).toEqual([
			{ role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { ok: true } } }] },
			{
				role: 'user',
				parts: [{ functionResponse: { name: 'named', response: { result: [1, 2] } } }]
			},
			{ role: 'user', parts: [{ functionResponse: { name: 'unknown', response: { result: 5 } } }] },
			{
				role: 'user',
				parts: [{ functionResponse: { name: 'function', response: { result: 'plain text' } } }]
			},
			{ role: 'user', parts: [{ functionResponse: { name: '7', response: { result: null } } }] }
		]);
	});

	it('maps an empty tool result to a raw result', () => {
		expect(toContents([{ role: 'tool', tool_call_id: 'x' }]).contents).toEqual([
			{ role: 'user', parts: [{ functionResponse: { name: 'x', response: { result: '' } } }] }
		]);
	});

	it('maps user and unknown roles to user parts with images, skipping empty content', () => {
		const { contents } = toContents([
			{ role: 'user', content: 'hi' },
			{ role: 'user', content: '' },
			{ role: 'user', content: { text: 'object' } },
			{
				role: 'function',
				content: [
					null,
					{ type: 'text', text: 'look' },
					{ type: 'text', text: 3 },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA\nBBB' } },
					{ type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
					{ type: 'image_url', image_url: 'https://example.com/raw.png' },
					{ type: 'input_audio', input_audio: {} }
				]
			},
			{ content: [{ type: 'audio' }] }
		]);
		expect(contents).toEqual([
			{ role: 'user', parts: [{ text: 'hi' }] },
			{
				role: 'user',
				parts: [
					{ text: 'look' },
					{ inlineData: { mimeType: 'image/png', data: 'AAA\nBBB' } },
					{ fileData: { fileUri: 'https://example.com/cat.png' } }
				]
			}
		]);
	});
});

/* ------------------------------- stream translator ------------------------------- */

const enc = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
			else controller.close();
		}
	});
}

/** Drain the translated stream into `choices`/`usage` per event plus a [DONE] flag. */
async function drain(stream: ReadableStream<Uint8Array>) {
	const text = await new Response(stream).text();
	const events = text
		.split('\n\n')
		.filter(Boolean)
		.map((e) => e.replace(/^data: /, ''));
	const done = events.at(-1) === '[DONE]';
	const chunks = events
		.filter((e) => e !== '[DONE]')
		.map((e) => {
			const o = JSON.parse(e);
			expect(o.object).toBe('chat.completion.chunk');
			expect(o.model).toBe('m');
			return o.usage ? { choices: o.choices, usage: o.usage } : { choices: o.choices };
		});
	return { chunks, done };
}

const delta = (index: number, d: Record<string, unknown>, finish: string | null = null) => ({
	choices: [{ index, delta: d, finish_reason: finish }]
});

describe('characterization — streamGeminiToOpenAi', () => {
	it('parses CRLF, unspaced and multi-line data fields, ignoring other SSE fields', async () => {
		const source = streamOf([
			'event: message\r\nid: 1\r\n: comment\r\n',
			'data:{"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\r\n\r\n',
			'data: {"candidates":\ndata: [{"content":{"parts":[{"text":"b"}]}}]}\n\n',
			'data: [DONE]\n\n',
			'data: {not json\n\n',
			'\n\n'
		]);
		const { chunks, done } = await drain(streamGeminiToOpenAi('m', source));
		expect(done).toBe(true);
		expect(chunks).toEqual([
			delta(0, { role: 'assistant', content: 'a' }),
			delta(0, { content: 'b' })
		]);
	});

	it('flushes a trailing event that has no terminating blank line', async () => {
		const withNewline = streamOf(['data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}\n']);
		expect((await drain(streamGeminiToOpenAi('m', withNewline))).chunks).toEqual([
			delta(0, { role: 'assistant', content: 'x' })
		]);
		const noNewline = streamOf(['data: {"candidates":[{"content":{"parts":[{"text":"y"}]}}]}']);
		expect((await drain(streamGeminiToOpenAi('m', noNewline))).chunks).toEqual([
			delta(0, { role: 'assistant', content: 'y' })
		]);
	});

	it('skips malformed candidates and parts, keeps candidate indexes, numbers tool calls', async () => {
		const source = streamOf([
			`data: ${JSON.stringify({
				candidates: [
					null,
					{
						index: 1,
						content: {
							parts: [
								null,
								{ text: '' },
								{ functionCall: { name: 'f', args: { a: 1 } } },
								{ text: 'after' },
								{ functionCall: {} },
								{ inlineData: {} }
							]
						},
						finishReason: 'STOP'
					},
					{ content: 'bad', finishReason: 'SAFETY' },
					{ content: { parts: [{ text: 'c' }] }, finishReason: 'MAX_TOKENS' }
				]
			})}\n\n`,
			`data: ${JSON.stringify({
				candidates: [{ content: { parts: [{ functionCall: { name: 'g' } }] } }],
				usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 1 }
			})}\n\n`,
			`data: ${JSON.stringify({ usageMetadata: { promptTokenCount: 1, totalTokenCount: 9 } })}\n\n`,
			`data: ${JSON.stringify({ candidates: 'nope' })}\n\n`
		]);
		const { chunks, done } = await drain(streamGeminiToOpenAi('m', source));
		expect(done).toBe(true);
		const call = (i: number, name: string, args: string) => ({
			index: i,
			id: `call_${i}`,
			type: 'function',
			function: { name, arguments: args }
		});
		expect(chunks).toEqual([
			delta(1, { role: 'assistant', tool_calls: [call(0, 'f', '{"a":1}')] }),
			delta(1, { content: 'after' }),
			delta(1, { tool_calls: [call(1, '', '{}')] }),
			delta(1, {}, 'tool_calls'),
			delta(0, {}, 'content_filter'),
			delta(0, { content: 'c' }),
			delta(0, {}, 'length'),
			delta(0, { tool_calls: [call(2, 'g', '{}')] }),
			{
				choices: [],
				usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }
			},
			{
				choices: [],
				usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 9 }
			}
		]);
	});

	it('closes without [DONE] when the upstream errors mid-stream', async () => {
		let i = 0;
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (i++ === 0) {
					controller.enqueue(
						enc.encode('data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n')
					);
				} else {
					controller.error(new Error('reset'));
				}
			}
		});
		const { chunks, done } = await drain(streamGeminiToOpenAi('m', source));
		expect(done).toBe(false);
		expect(chunks).toEqual([delta(0, { role: 'assistant', content: 'partial' })]);
	});

	it('forwards a client cancel to the upstream source', async () => {
		const cancel = vi.fn();
		const source = new ReadableStream<Uint8Array>({
			pull: () => new Promise(() => {}),
			cancel
		});
		const reader = streamGeminiToOpenAi('m', source).getReader();
		await reader.cancel('client gone');
		expect(cancel).toHaveBeenCalledWith('client gone');
	});
});
