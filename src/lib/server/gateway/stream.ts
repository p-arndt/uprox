/** Streamed responses: the SSE pass-through tap and background usage recording. */
import type { NormalizedUsage } from '$lib/server/usage';
import type { ProviderDef } from '$lib/server/providers';
import { isRecord } from '$lib/server/json';
import type { RequestContext } from './context';
import { recordCompletion, type CacheTarget, type UsageExtractor } from './record-usage';

export interface DrainedSse {
	usage: NormalizedUsage | null;
	/**
	 * The verbatim SSE body, reassembled — used to cache and trace a streamed
	 * response. Empty unless `keepRaw` was set; stops growing past
	 * {@link MAX_RAW_SSE_CHARS}, which is already beyond what the cache stores.
	 */
	raw: string;
	/** false if the stream errored or was cancelled before completing (don't cache) */
	complete: boolean;
}

/**
 * Accumulating more than this is pointless: the response cache skips bodies
 * over 1 MB and request traces are clamped far below that.
 */
const MAX_RAW_SSE_CHARS = 1_000_000;

/**
 * Pass an SSE stream through to the client unchanged while watching it: every
 * complete `data:` line is fed to the usage extractor (the last usage seen
 * wins), and the raw body is kept only when asked to (for caching or tracing).
 *
 * Unlike `tee()`, nothing is buffered for a second consumer: bytes flow at the
 * client's pace, and when the client goes away the cancellation is forwarded to
 * the source, which aborts the upstream request. `done` settles once the stream
 * finishes, errors or is cancelled, and never rejects.
 */
export function tapSseStream(
	source: ReadableStream<Uint8Array>,
	extract: UsageExtractor,
	opts: { keepRaw: boolean }
): { stream: ReadableStream<Uint8Array>; done: Promise<DrainedSse> } {
	const reader = source.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let raw = '';
	let usage: NormalizedUsage | null = null;

	let resolveDone!: (result: DrainedSse) => void;
	const done = new Promise<DrainedSse>((resolve) => (resolveDone = resolve));
	let settled = false;
	const settle = (complete: boolean) => {
		if (settled) return;
		settled = true;
		resolveDone({ usage, raw, complete });
	};

	const takeLine = (line: string) => {
		if (!line.startsWith('data:')) return;
		const data = line.slice(5).trim();
		if (!data || data === '[DONE]') return;
		try {
			const parsed: unknown = JSON.parse(data);
			const norm = isRecord(parsed) ? extract(parsed) : null;
			if (norm) usage = norm;
		} catch {
			// ignore non-JSON keepalive/comment lines
		}
	};

	const feed = (text: string) => {
		if (opts.keepRaw && raw.length <= MAX_RAW_SSE_CHARS) raw += text;
		buffer += text;
		let nl: number;
		while ((nl = buffer.indexOf('\n')) !== -1) {
			takeLine(buffer.slice(0, nl));
			buffer = buffer.slice(nl + 1);
		}
	};

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			let result: ReadableStreamReadResult<Uint8Array>;
			try {
				result = await reader.read();
			} catch (err) {
				settle(false);
				controller.error(err);
				return;
			}
			if (result.done) {
				feed(decoder.decode());
				takeLine(buffer);
				buffer = '';
				settle(true);
				controller.close();
				return;
			}
			controller.enqueue(result.value);
			feed(decoder.decode(result.value, { stream: true }));
		},
		async cancel(reason) {
			settle(false);
			await reader.cancel(reason).catch(() => {});
		}
	});

	return { stream, done };
}

export interface StreamRecording {
	provider: ProviderDef;
	upstream: Response;
	source: ReadableStream<Uint8Array>;
	extract: UsageExtractor;
	cache: CacheTarget | null;
	detail: string;
	release: () => void;
}

/**
 * Hand a streamed response to the client while its usage is captured in-line
 * and recorded once the stream finishes (or the client disconnects). The raw
 * body is only kept when something will use it: the response cache or the
 * request trace.
 */
export function streamWithRecording(ctx: RequestContext, s: StreamRecording): Response {
	const tap = tapSseStream(s.source, s.extract, {
		keepRaw: s.cache !== null || ctx.token.effective.tracingEnabled
	});
	void tap.done
		.then(({ usage, raw, complete }) =>
			recordCompletion(ctx, {
				provider: s.provider,
				statusCode: s.upstream.status,
				ok: true,
				usage,
				response: raw,
				format: 'sse',
				detail: s.detail,
				cache: s.cache,
				complete,
				release: s.release
			})
		)
		.catch((err) => console.error('[gateway] failed to record streamed request', err));
	return new Response(tap.stream, {
		status: s.upstream.status,
		headers: {
			'content-type': s.upstream.headers.get('content-type') ?? 'text/event-stream',
			'cache-control': 'no-cache',
			...(s.cache ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}
