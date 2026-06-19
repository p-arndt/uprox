import { describe, it, expect } from 'vitest';
import {
	safeParse,
	flattenContent,
	requestMessages,
	reconstructSse,
	responseText,
	responseMessage,
	parseTraceparent,
	parseTraceMetadata,
	parseMetaFilter,
	prettyJson
} from '$lib/trace';

describe('safeParse', () => {
	it('parses valid JSON and returns null for invalid/empty', () => {
		expect(safeParse('{"a":1}')).toEqual({ a: 1 });
		expect(safeParse('not json')).toBeNull();
		expect(safeParse('')).toBeNull();
		expect(safeParse(null)).toBeNull();
	});
});

describe('flattenContent', () => {
	it('passes a bare string through', () => {
		expect(flattenContent('hello')).toBe('hello');
	});

	it('joins an OpenAI content-parts array, keeping text and noting non-text', () => {
		const parts = [
			{ type: 'text', text: 'describe this' },
			{ type: 'image_url', image_url: { url: 'http://x' } }
		];
		expect(flattenContent(parts)).toBe('describe this\n[image_url]');
	});

	it('flattens Gemini parts', () => {
		expect(flattenContent([{ text: 'a' }, { text: 'b' }])).toBe('a\nb');
	});

	it('returns empty string for nullish', () => {
		expect(flattenContent(null)).toBe('');
		expect(flattenContent(undefined)).toBe('');
	});
});

describe('requestMessages', () => {
	it('reads OpenAI chat messages with tool calls', () => {
		const body = JSON.stringify({
			messages: [
				{ role: 'system', content: 'be terse' },
				{ role: 'user', content: 'weather?' },
				{
					role: 'assistant',
					content: '',
					tool_calls: [{ function: { name: 'get_weather', arguments: '{"city":"NYC"}' } }]
				}
			]
		});
		const msgs = requestMessages(body);
		expect(msgs).toHaveLength(3);
		expect(msgs[0]).toMatchObject({ role: 'system', text: 'be terse' });
		expect(msgs[2].toolCalls).toEqual([{ name: 'get_weather', args: '{"city":"NYC"}' }]);
	});

	it('reads the Responses API string input', () => {
		expect(requestMessages(JSON.stringify({ input: 'hi there' }))).toEqual([
			{ role: 'user', text: 'hi there', toolCalls: undefined }
		]);
	});

	it('treats a string-array input as a single embeddings prompt', () => {
		expect(requestMessages(JSON.stringify({ input: ['a', 'b'] }))).toEqual([
			{ role: 'user', text: 'a\nb', toolCalls: undefined }
		]);
	});

	it('reads native Gemini contents plus systemInstruction', () => {
		const body = JSON.stringify({
			systemInstruction: { parts: [{ text: 'be nice' }] },
			contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
		});
		const msgs = requestMessages(body);
		expect(msgs[0]).toMatchObject({ role: 'system', text: 'be nice' });
		expect(msgs[1]).toMatchObject({ role: 'user', text: 'hello' });
	});

	it('returns [] for unrecognized or invalid payloads', () => {
		expect(requestMessages('garbage')).toEqual([]);
		expect(requestMessages(JSON.stringify({ foo: 'bar' }))).toEqual([]);
		expect(requestMessages(null)).toEqual([]);
	});
});

describe('reconstructSse', () => {
	it('concatenates OpenAI chat delta content across data lines', () => {
		const raw = [
			'data: {"choices":[{"delta":{"content":"Hel"}}]}',
			'data: {"choices":[{"delta":{"content":"lo"}}]}',
			'data: [DONE]'
		].join('\n\n');
		expect(reconstructSse(raw)).toBe('Hello');
	});

	it('handles OpenAI Responses output_text deltas', () => {
		const raw = [
			'data: {"type":"response.output_text.delta","delta":"foo"}',
			'data: {"type":"response.output_text.delta","delta":"bar"}'
		].join('\n');
		expect(reconstructSse(raw)).toBe('foobar');
	});

	it('handles native Gemini candidate parts', () => {
		const raw = 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}';
		expect(reconstructSse(raw)).toBe('hi');
	});

	it('ignores keepalive/non-JSON lines', () => {
		const raw = ': ping\n\ndata: {"choices":[{"delta":{"content":"x"}}]}';
		expect(reconstructSse(raw)).toBe('x');
	});
});

describe('responseText', () => {
	it('reads a buffered OpenAI chat reply', () => {
		const body = JSON.stringify({ choices: [{ message: { content: 'the answer' } }] });
		expect(responseText(body, 'json')).toBe('the answer');
	});

	it('prefers output_text for the Responses API', () => {
		expect(responseText(JSON.stringify({ output_text: 'resp' }), 'json')).toBe('resp');
	});

	it('reads a buffered Gemini reply', () => {
		const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gem' }] } }] });
		expect(responseText(body, 'json')).toBe('gem');
	});

	it('reconstructs a streamed reply when format is sse', () => {
		const raw = 'data: {"choices":[{"delta":{"content":"streamed"}}]}';
		expect(responseText(raw, 'sse')).toBe('streamed');
	});

	it('returns empty string for missing or unparseable bodies', () => {
		expect(responseText(null, 'json')).toBe('');
		expect(responseText('garbage', 'json')).toBe('');
	});
});

describe('tool use — requests', () => {
	it('reads an OpenAI tool-result message (role tool)', () => {
		const body = JSON.stringify({
			messages: [
				{ role: 'user', content: 'weather?' },
				{ role: 'tool', tool_call_id: 'c1', content: '{"tempC":21}' }
			]
		});
		const msgs = requestMessages(body);
		expect(msgs[1]).toMatchObject({ role: 'tool', text: '{"tempC":21}' });
	});

	it('reads Gemini functionCall and functionResponse parts', () => {
		const body = JSON.stringify({
			contents: [
				{
					role: 'model',
					parts: [{ functionCall: { name: 'get_weather', args: { city: 'Berlin' } } }]
				},
				{
					role: 'user',
					parts: [{ functionResponse: { name: 'get_weather', response: { tempC: 21 } } }]
				}
			]
		});
		const msgs = requestMessages(body);
		expect(msgs[0].toolCalls).toEqual([{ name: 'get_weather', args: '{"city":"Berlin"}' }]);
		expect(msgs[1].role).toBe('tool');
		expect(msgs[1].text).toContain('get_weather → {"tempC":21}');
	});
});

describe('tool use — responses', () => {
	it('extracts buffered OpenAI chat tool calls', () => {
		const body = JSON.stringify({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [{ function: { name: 'get_weather', arguments: '{"city":"Berlin"}' } }]
					}
				}
			]
		});
		const msg = responseMessage(body, 'json');
		expect(msg.toolCalls).toEqual([{ name: 'get_weather', args: '{"city":"Berlin"}' }]);
	});

	it('accumulates streamed OpenAI tool-call name + fragmented args by index', () => {
		const raw = [
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather","arguments":"{\\"ci"}}]}}]}',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"Berlin\\"}"}}]}}]}',
			'data: [DONE]'
		].join('\n');
		const msg = responseMessage(raw, 'sse');
		expect(msg.toolCalls).toEqual([{ name: 'get_weather', args: '{"city":"Berlin"}' }]);
	});

	it('extracts Responses API function_call items', () => {
		const body = JSON.stringify({
			output: [{ type: 'function_call', name: 'get_weather', arguments: '{"city":"NYC"}' }]
		});
		expect(responseMessage(body, 'json').toolCalls).toEqual([
			{ name: 'get_weather', args: '{"city":"NYC"}' }
		]);
	});

	it('extracts Gemini functionCall from a buffered response', () => {
		const body = JSON.stringify({
			candidates: [
				{
					content: { parts: [{ functionCall: { name: 'get_weather', args: { city: 'Berlin' } } }] }
				}
			]
		});
		expect(responseMessage(body, 'json').toolCalls).toEqual([
			{ name: 'get_weather', args: '{"city":"Berlin"}' }
		]);
	});

	it('keeps text and tool calls together when both are present', () => {
		const body = JSON.stringify({
			choices: [
				{
					message: {
						content: 'let me check',
						tool_calls: [{ function: { name: 'get_weather', arguments: '{}' } }]
					}
				}
			]
		});
		const msg = responseMessage(body, 'json');
		expect(msg.text).toBe('let me check');
		expect(msg.toolCalls).toHaveLength(1);
	});

	it('returns no toolCalls for a plain text reply', () => {
		expect(
			responseMessage(JSON.stringify({ output_text: 'hi' }), 'json').toolCalls
		).toBeUndefined();
	});
});

describe('parseTraceparent', () => {
	it('extracts the lower-cased trace-id from a valid traceparent', () => {
		expect(parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01')).toBe(
			'4bf92f3577b34da6a3ce929d0e0e4736'
		);
	});

	it('returns null for malformed or missing values', () => {
		expect(parseTraceparent('not-a-traceparent')).toBeNull();
		expect(parseTraceparent('00-tooshort-00f067aa0ba902b7-01')).toBeNull();
		expect(parseTraceparent(null)).toBeNull();
		expect(parseTraceparent('')).toBeNull();
	});
});

describe('parseTraceMetadata', () => {
	it('reads the JSON header object', () => {
		expect(parseTraceMetadata('{"chat_id":"c1","user_id":"u9"}')).toEqual({
			chat_id: 'c1',
			user_id: 'u9'
		});
	});

	it('merges x-uprox-meta-* header pairs (string values)', () => {
		const pairs: [string, string][] = [
			['x-uprox-meta-tenant', 'acme'],
			['X-Uprox-Meta-Experiment', 'b'],
			['authorization', 'Bearer x']
		];
		expect(parseTraceMetadata(null, pairs)).toEqual({ tenant: 'acme', experiment: 'b' });
	});

	it('combines both sources, with per-key headers alongside JSON', () => {
		expect(parseTraceMetadata('{"chat_id":"c1"}', [['x-uprox-meta-tenant', 'acme']])).toEqual({
			chat_id: 'c1',
			tenant: 'acme'
		});
	});

	it('ignores a malformed JSON header and returns null when empty', () => {
		expect(parseTraceMetadata('not json')).toBeNull();
		expect(parseTraceMetadata(null, [])).toBeNull();
		expect(parseTraceMetadata('[1,2]')).toBeNull();
	});
});

describe('parseMetaFilter', () => {
	it('parses key:value and key=value into an exact pair', () => {
		expect(parseMetaFilter('user_id:u_42')).toEqual({ key: 'user_id', value: 'u_42' });
		expect(parseMetaFilter('tenant=acme')).toEqual({ key: 'tenant', value: 'acme' });
	});

	it('treats a bare key as an existence filter (value null)', () => {
		expect(parseMetaFilter('chat_id')).toEqual({ key: 'chat_id', value: null });
	});

	it('trims, tolerates a value with colons, and returns null when empty/invalid', () => {
		expect(parseMetaFilter('  url : https://x/y ')).toEqual({ key: 'url', value: 'https://x/y' });
		expect(parseMetaFilter('key:')).toEqual({ key: 'key', value: null });
		expect(parseMetaFilter('')).toBeNull();
		expect(parseMetaFilter(null)).toBeNull();
		expect(parseMetaFilter(':nope')).toBeNull();
	});
});

describe('prettyJson', () => {
	it('pretty-prints JSON', () => {
		expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
	});

	it('returns the original text when not JSON, and empty for nullish', () => {
		expect(prettyJson('hello')).toBe('hello');
		expect(prettyJson(null)).toBe('');
	});
});
