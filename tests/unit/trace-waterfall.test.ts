import { describe, expect, it } from 'vitest';
import { callSpan, callsWindow, rawResponseBody, waterfallBar } from '$lib/features/traces/trace';
import { formatDuration } from '$lib/format';
import { spanKindAccent } from '$lib/features/traces/otel';

describe('callSpan', () => {
	it('ends at createdAt and starts latency earlier', () => {
		expect(callSpan({ createdAt: new Date(10_000), latencyMs: 250 })).toEqual({
			start: 9_750,
			end: 10_000
		});
	});

	it('treats a missing latency as an instant', () => {
		expect(callSpan({ createdAt: new Date(5_000).toISOString(), latencyMs: null })).toEqual({
			start: 5_000,
			end: 5_000
		});
	});
});

describe('callsWindow', () => {
	it('covers every call', () => {
		const calls = [
			{ createdAt: new Date(2_000), latencyMs: 1_500 },
			{ createdAt: new Date(4_000), latencyMs: 100 }
		];
		expect(callsWindow(calls)).toEqual({ start: 500, end: 4_000 });
	});

	it('is empty for no calls', () => {
		expect(callsWindow([])).toEqual({ start: 0, end: 0 });
	});
});

describe('waterfallBar', () => {
	const win = { start: 1_000, end: 2_000 };

	it('positions a bar as percentages of the window', () => {
		expect(waterfallBar(1_250, 500, win, 1)).toEqual({ left: 25, width: 50 });
	});

	it('keeps a minimum width', () => {
		expect(waterfallBar(1_000, 0, win, 1.5).width).toBe(1.5);
	});

	it('never divides by a zero-length window', () => {
		const bar = waterfallBar(0, 0, { start: 0, end: 0 }, 2);
		expect(bar).toEqual({ left: 0, width: 2 });
	});
});

describe('rawResponseBody', () => {
	it('keeps SSE verbatim and pretty-prints JSON', () => {
		expect(rawResponseBody('data: {"a":1}', 'sse')).toBe('data: {"a":1}');
		expect(rawResponseBody(null, 'sse')).toBe('');
		expect(rawResponseBody('{"a":1}', 'json')).toBe('{\n  "a": 1\n}');
	});
});

describe('formatDuration', () => {
	it('formats ms, seconds and unknown', () => {
		expect(formatDuration(null)).toBe('—');
		expect(formatDuration(undefined)).toBe('—');
		expect(formatDuration(0)).toBe('0ms');
		expect(formatDuration(849.6)).toBe('850ms');
		expect(formatDuration(1_000)).toBe('1.00s');
		expect(formatDuration(1_234)).toBe('1.23s');
	});
});

describe('spanKindAccent', () => {
	it('maps known kinds and mutes unknown ones', () => {
		expect(spanKindAccent('LLM')).toContain('emerald');
		expect(spanKindAccent('SOMETHING')).toBe('text-muted-foreground');
	});
});
