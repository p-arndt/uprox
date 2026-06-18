import { describe, it, expect } from 'vitest';
import { parseOtlpProtobuf, parseOtlpJson } from '$lib/server/otlp/decode';
import { buildSpanTree, flattenTree, traceWindow, spanDetail, spanKind } from '$lib/otel';

/* ------- a tiny, independent protobuf encoder to exercise the wire decoder ------ */

function vint(n: number | bigint): number[] {
	let v = BigInt(n);
	const out: number[] = [];
	do {
		let b = Number(v & 0x7fn);
		v >>= 7n;
		if (v > 0n) b |= 0x80;
		out.push(b);
	} while (v > 0n);
	return out;
}
const tag = (no: number, wt: number) => vint((no << 3) | wt);
const ld = (no: number, bytes: number[]) => [...tag(no, 2), ...vint(bytes.length), ...bytes];
const vfield = (no: number, n: number | bigint) => [...tag(no, 0), ...vint(n)];
function f64field(no: number, n: bigint): number[] {
	const out = [...tag(no, 1)];
	let v = n;
	for (let i = 0; i < 8; i++) {
		out.push(Number(v & 0xffn));
		v >>= 8n;
	}
	return out;
}
const sbytes = (s: string) => [...new TextEncoder().encode(s)];
const anyStr = (s: string) => ld(1, sbytes(s)); // AnyValue { string_value = 1 }
const keyValue = (k: string, v: number[]) => [...ld(1, sbytes(k)), ...ld(2, v)];

describe('parseOtlpProtobuf', () => {
	it('decodes a single span with attributes, times, and status', () => {
		const traceId = Array.from({ length: 16 }, (_, i) => i + 1); // 0102…10
		const spanId = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22];

		const span = [
			...ld(1, traceId),
			...ld(2, spanId),
			...ld(5, sbytes('OpenAI.chat')),
			...vfield(6, 1), // kind INTERNAL
			...f64field(7, 1_000_000_000n), // start 1s
			...f64field(8, 1_500_000_000n), // end 1.5s → 500ms
			...ld(9, keyValue('llm.model_name', anyStr('gpt-4o'))),
			...ld(15, vfield(3, 2)) // Status { code = ERROR }
		];
		const scopeSpans = ld(2, span); // ScopeSpans { spans = 2 }
		const resource = ld(1, keyValue('service.name', anyStr('my-app'))); // Resource { attrs = 1 }
		// ResourceSpans { resource = 1, scope_spans = 2 } — scope_spans wraps ScopeSpans
		const resourceSpans = [...ld(1, resource), ...ld(2, scopeSpans)];
		const req = ld(1, resourceSpans); // ExportTraceServiceRequest { resource_spans = 1 }

		const spans = parseOtlpProtobuf(new Uint8Array(req));
		expect(spans).toHaveLength(1);
		const s = spans[0];
		expect(s.traceId).toBe('0102030405060708090a0b0c0d0e0f10');
		expect(s.spanId).toBe('aabbccddeeff1122');
		expect(s.name).toBe('OpenAI.chat');
		expect(s.kind).toBe('INTERNAL');
		expect(s.durationMs).toBe(500);
		expect(s.startedAt.getTime()).toBe(1000);
		expect(s.status).toBe('error');
		expect(s.serviceName).toBe('my-app');
		expect(s.attributes['llm.model_name']).toBe('gpt-4o');
	});
});

describe('parseOtlpJson', () => {
	it('decodes the JSON wire shape including parent links and attribute types', () => {
		const payload = {
			resourceSpans: [
				{
					resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: 'ABCDEF00000000000000000000000001',
									spanId: '1111111111111111',
									name: 'root',
									kind: 'SPAN_KIND_INTERNAL',
									startTimeUnixNano: '1000000000',
									endTimeUnixNano: '2000000000',
									status: { code: 'STATUS_CODE_OK' },
									attributes: [
										{ key: 'llm.token_count.prompt', value: { intValue: '42' } },
										{ key: 'openinference.span.kind', value: { stringValue: 'LLM' } }
									]
								}
							]
						}
					]
				}
			]
		};
		const spans = parseOtlpJson(payload);
		expect(spans).toHaveLength(1);
		expect(spans[0].traceId).toBe('abcdef00000000000000000000000001');
		expect(spans[0].kind).toBe('INTERNAL');
		expect(spans[0].status).toBe('ok');
		expect(spans[0].serviceName).toBe('svc');
		expect(spans[0].durationMs).toBe(1000);
		expect(spans[0].attributes['llm.token_count.prompt']).toBe(42);
	});

	it('returns [] for a payload with no resourceSpans', () => {
		expect(parseOtlpJson({})).toEqual([]);
		expect(parseOtlpJson(null)).toEqual([]);
	});
});

describe('span tree', () => {
	const spans = [
		{ spanId: 'a', parentSpanId: null, name: 'root', status: 'ok', startedAt: new Date(0), durationMs: 100 },
		{ spanId: 'b', parentSpanId: 'a', name: 'child1', status: 'ok', startedAt: new Date(10), durationMs: 40 },
		{ spanId: 'c', parentSpanId: 'a', name: 'child2', status: 'ok', startedAt: new Date(5), durationMs: 20 },
		{ spanId: 'd', parentSpanId: 'b', name: 'grandchild', status: 'ok', startedAt: new Date(12), durationMs: 10 }
	];

	it('nests by parent and orders siblings by start time', () => {
		const roots = buildSpanTree(spans);
		expect(roots).toHaveLength(1);
		expect(roots[0].spanId).toBe('a');
		// child2 (t=5) sorts before child1 (t=10)
		expect(roots[0].children.map((c) => c.spanId)).toEqual(['c', 'b']);
	});

	it('flattens depth-first with depth set', () => {
		const flat = flattenTree(buildSpanTree(spans));
		expect(flat.map((s) => s.spanId)).toEqual(['a', 'c', 'b', 'd']);
		expect(flat.find((s) => s.spanId === 'd')?.depth).toBe(2);
	});

	it('treats orphaned spans (missing parent) as roots', () => {
		const roots = buildSpanTree([
			{ spanId: 'x', parentSpanId: 'gone', name: 'orphan', status: 'ok', startedAt: new Date(0), durationMs: 1 }
		]);
		expect(roots).toHaveLength(1);
		expect(roots[0].spanId).toBe('x');
	});

	it('computes the trace window across all spans', () => {
		const win = traceWindow(spans);
		expect(win.start).toBe(0);
		expect(win.end).toBe(100); // root (start 0, dur 100) ends last
	});
});

describe('spanDetail / spanKind', () => {
	it('extracts OpenInference headline fields', () => {
		const s = {
			spanId: 'a',
			parentSpanId: null,
			name: 'llm',
			status: 'ok',
			startedAt: new Date(0),
			durationMs: 1,
			attributes: {
				'openinference.span.kind': 'LLM',
				'llm.model_name': 'gpt-4o',
				'input.value': 'hi',
				'output.value': 'hello',
				'llm.token_count.prompt': 10,
				'llm.token_count.completion': 3
			}
		};
		expect(spanKind(s)).toBe('LLM');
		expect(spanDetail(s)).toEqual({
			kind: 'LLM',
			model: 'gpt-4o',
			input: 'hi',
			output: 'hello',
			tokensIn: 10,
			tokensOut: 3
		});
	});

	it('falls back to the OTLP kind and tolerates missing attributes', () => {
		const s = {
			spanId: 'a',
			parentSpanId: null,
			name: 'x',
			kind: 'SERVER',
			status: 'ok',
			startedAt: new Date(0),
			durationMs: 1
		};
		expect(spanKind(s)).toBe('SERVER');
		expect(spanDetail(s).model).toBeNull();
	});
});
