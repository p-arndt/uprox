import { describe, it, expect } from 'vitest';
import { tapSseStream, type UsageExtractor } from '$lib/server/gateway';
import { normalizeUsage } from '$lib/server/usage';

const encoder = new TextEncoder();
const extract: UsageExtractor = (obj) => normalizeUsage(obj.usage);

/** A byte stream that emits the given string chunks, then closes. */
function sourceOf(chunks: string[]): ReadableStream<Uint8Array> {
	let i = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
			else controller.close();
		}
	});
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
	return new Response(stream).text();
}

const body = [
	'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
	'data: {"choices":[],"usage":{"prompt_tokens":12,',
	'"completion_tokens":3}}\n\n',
	'data: [DONE]\n\n'
];

describe('tapSseStream', () => {
	it('passes bytes through unchanged and captures usage split across chunks', async () => {
		const tap = tapSseStream(sourceOf(body), extract, { keepRaw: true });

		expect(await readAll(tap.stream)).toBe(body.join(''));
		const result = await tap.done;
		expect(result.complete).toBe(true);
		expect(result.usage).toEqual({ input: 12, output: 3, cacheRead: null, cacheWrite: null });
		expect(result.raw).toBe(body.join(''));
	});

	it('does not accumulate the raw body unless asked to', async () => {
		const tap = tapSseStream(sourceOf(body), extract, { keepRaw: false });

		expect(await readAll(tap.stream)).toBe(body.join(''));
		const result = await tap.done;
		expect(result.raw).toBe('');
		expect(result.usage?.input).toBe(12);
	});

	it('parses a final data line that has no trailing newline', async () => {
		const tap = tapSseStream(
			sourceOf(['data: {"usage":{"input_tokens":5,"output_tokens":1}}']),
			extract,
			{ keepRaw: false }
		);
		await readAll(tap.stream);
		expect((await tap.done).usage).toEqual({
			input: 5,
			output: 1,
			cacheRead: null,
			cacheWrite: null
		});
	});

	it('forwards a client cancel to the source and settles as incomplete', async () => {
		let cancelledWith: unknown = 'not cancelled';
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(body[0]));
				// never closes: an upstream still generating
			},
			cancel(reason) {
				cancelledWith = reason;
			}
		});
		const tap = tapSseStream(source, extract, { keepRaw: true });

		const reader = tap.stream.getReader();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toBe(body[0]);
		await reader.cancel('client gone');

		const result = await tap.done;
		expect(result.complete).toBe(false);
		expect(result.raw).toBe(body[0]);
		expect(cancelledWith).toBe('client gone');
	});

	it('errors the client stream and settles as incomplete when the source fails', async () => {
		let sent = false;
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (!sent) {
					sent = true;
					controller.enqueue(encoder.encode(body[1]));
				} else {
					controller.error(new Error('upstream reset'));
				}
			}
		});
		const tap = tapSseStream(source, extract, { keepRaw: true });

		await expect(readAll(tap.stream)).rejects.toThrow('upstream reset');
		const result = await tap.done;
		expect(result.complete).toBe(false);
		expect(result.usage).toBeNull();
	});
});
