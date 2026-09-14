import { describe, it, expect } from 'vitest';
import { parseOtlpProtobuf, parseOtlpJson } from '$lib/server/otlp/decode';
import {
	buildSpanTree,
	flattenTree,
	traceWindow,
	spanDetail,
	spanKind
} from '$lib/features/traces/otel';

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

	// Regression: a deeply nested AnyValue (kvlist within kvlist …) must not blow
	// the stack — the decoder caps recursion depth and truncates beyond it instead
	// of crashing the process (DoS hardening for the authenticated OTLP ingest).
	it('bounds recursion on a pathologically nested attribute (no stack overflow)', () => {
		let value: Record<string, unknown> = { stringValue: 'leaf' };
		for (let i = 0; i < 5000; i++) {
			value = { kvlistValue: { values: [{ key: 'k', value }] } };
		}
		const payload = {
			resourceSpans: [
				{
					resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: 'abcdef00000000000000000000000001',
									spanId: '1111111111111111',
									name: 'deep',
									startTimeUnixNano: '1000000000',
									endTimeUnixNano: '2000000000',
									attributes: [{ key: 'deep', value }]
								}
							]
						}
					]
				}
			]
		};

		let spans: ReturnType<typeof parseOtlpJson> | undefined;
		expect(() => {
			spans = parseOtlpJson(payload);
		}).not.toThrow();
		expect(spans).toHaveLength(1);
		// the span still decodes; the over-deep attribute is present but truncated
		expect(spans?.[0].name).toBe('deep');
		expect(spans?.[0].serviceName).toBe('svc');
		expect(spans?.[0].attributes).toHaveProperty('deep');
	});
});

describe('characterization — parseOtlpProtobuf', () => {
	const fixed32 = (no: number) => [...tag(no, 5), 1, 2, 3, 4];
	const bitsOf = (n: number) => new DataView(Float64Array.of(n).buffer).getBigUint64(0, true);
	const attr = (k: string, v: number[]) => ld(9, keyValue(k, v));
	const decodeOne = (span: number[]) =>
		parseOtlpProtobuf(new Uint8Array(ld(1, ld(2, ld(2, span)))))[0];

	it('decodes every AnyValue variant and skips unknown fields and keyless entries', () => {
		const span = [
			...attr('str', anyStr('s')),
			...attr('bool', vfield(2, 1)),
			...attr('false', vfield(2, 0)),
			...attr('int', vfield(3, BigInt.asUintN(64, -5n))),
			...attr('double', f64field(4, bitsOf(1.5))),
			...attr('array', ld(5, [...ld(1, anyStr('a')), ...vfield(2, 7), ...ld(1, vfield(3, 2))])),
			...attr(
				'kvlist',
				ld(6, [
					...ld(1, keyValue('inner', anyStr('x'))),
					...ld(1, keyValue('', anyStr('drop'))),
					...fixed32(2)
				])
			),
			...attr('bytes', ld(7, [1, 2, 3])),
			...attr('late', [...fixed32(9), ...vfield(8, 1), ...anyStr('late')]),
			...attr('empty', []),
			...ld(9, ld(1, sbytes('novalue'))),
			...ld(9, keyValue('', anyStr('keyless'))),
			...ld(9, [...vfield(3, 1), ...keyValue('extra', anyStr('e'))])
		];
		expect(decodeOne(span).attributes).toEqual({
			str: 's',
			bool: true,
			false: false,
			int: -5,
			double: 1.5,
			array: ['a', 2],
			kvlist: { inner: 'x' },
			bytes: '[bytes]',
			late: 'late',
			empty: null,
			novalue: null,
			extra: 'e'
		});
	});

	it('truncates arrays nested past the depth cap', () => {
		let value = anyStr('leaf');
		for (let i = 0; i < 40; i++) value = ld(5, ld(1, value));
		let v: unknown = decodeOne(attr('deep', value)).attributes.deep;
		let depth = 0;
		while (Array.isArray(v)) {
			v = v[0];
			depth++;
		}
		expect(depth).toBe(32);
		expect(v).toBe('[truncated]');
	});

	it('reads span fields, resolves resources in any order and skips unknown fields', () => {
		const full = [
			...ld(1, [0xab, 0xcd]),
			...ld(2, [0x01]),
			...ld(3, sbytes('tracestate')),
			...ld(4, [0x0f, 0xf0]),
			...ld(5, sbytes('child')),
			...vfield(6, 3),
			...f64field(7, 2_500_000_000n),
			...f64field(8, 1_000_000_000n),
			...fixed32(12),
			...ld(15, [...ld(2, sbytes('fine')), ...vfield(3, 1)])
		];
		const oddKind = [...ld(5, sbytes('odd')), ...vfield(6, 9), ...ld(15, vfield(3, 7))];
		const zeroKind = [...ld(5, sbytes('zero')), ...vfield(6, 0), ...ld(15, [])];
		const scopeSpans = [
			...ld(1, ld(1, sbytes('scope-name'))),
			...ld(2, full),
			...vfield(3, 1),
			...ld(2, []),
			...ld(2, oddKind),
			...ld(2, zeroKind)
		];
		const resource = [
			...ld(1, keyValue('service.name', vfield(3, 5))),
			...ld(1, keyValue('service.name', anyStr('svc-pb'))),
			...vfield(2, 0)
		];
		// scope_spans before resource: the resource must still apply
		const rs1 = [...ld(2, scopeSpans), ...ld(1, resource), ...ld(3, sbytes('schema'))];
		const rs2 = ld(2, ld(2, ld(5, sbytes('second'))));
		const rs3 = [
			...ld(1, ld(1, keyValue('service.name', vfield(2, 1)))),
			...ld(2, ld(2, ld(5, sbytes('third'))))
		];
		const req = [...vfield(2, 3), ...ld(1, rs1), ...f64field(4, 1n), ...ld(1, rs2), ...ld(1, rs3)];

		const empty = {
			traceId: '',
			spanId: '',
			parentSpanId: null,
			name: '',
			kind: null,
			startedAt: new Date(0),
			durationMs: 0,
			status: 'unset',
			serviceName: 'svc-pb',
			attributes: {}
		};
		expect(parseOtlpProtobuf(new Uint8Array(req))).toEqual([
			{
				traceId: 'abcd',
				spanId: '01',
				parentSpanId: '0ff0',
				name: 'child',
				kind: 'CLIENT',
				startedAt: new Date(2500),
				durationMs: 0,
				status: 'ok',
				serviceName: 'svc-pb',
				attributes: {}
			},
			empty,
			{ ...empty, name: 'odd' },
			{ ...empty, name: 'zero' },
			{ ...empty, name: 'second', serviceName: null },
			{ ...empty, name: 'third', serviceName: null }
		]);
	});

	// Regression: skipping a length-delimited field used to add the length to the
	// position read *before* the length prefix, landing short and misaligning
	// every following field (e.g. after the InstrumentationScope real exporters send).
	it('stays aligned after skipping an unknown length-delimited field', () => {
		const scope = ld(1, [
			...ld(1, sbytes('openinference.instrumentation')),
			...ld(2, sbytes('1.0'))
		]);
		const spanBytes = [...ld(3, sbytes('state=1')), ...ld(5, sbytes('after-skip'))];
		const req = ld(1, ld(2, [...scope, ...ld(2, spanBytes)]));
		const spans = parseOtlpProtobuf(new Uint8Array(req));
		expect(spans).toHaveLength(1);
		expect(spans[0].name).toBe('after-skip');
	});

	it('throws on an unsupported wire type in a skipped field', () => {
		expect(() => parseOtlpProtobuf(new Uint8Array(tag(2, 3)))).toThrow('unsupported wire type 3');
		expect(parseOtlpProtobuf(new Uint8Array())).toEqual([]);
	});
});

describe('characterization — parseOtlpJson', () => {
	const base = {
		traceId: 'AA',
		spanId: 'BB',
		name: 'n',
		startTimeUnixNano: '1000000',
		endTimeUnixNano: '3000000'
	};

	it('returns [] unless the payload carries a resourceSpans array', () => {
		expect(parseOtlpJson({ resourceSpans: {} })).toEqual([]);
		expect(parseOtlpJson([])).toEqual([]);
		expect(parseOtlpJson('x')).toEqual([]);
	});

	it('walks scopeSpans, falls back to instrumentationLibrarySpans and skips malformed entries', () => {
		const spans = parseOtlpJson({
			resourceSpans: [
				null,
				{
					resource: { attributes: [{ key: 'service.name', value: { stringValue: 'a' } }] },
					scopeSpans: [null, { spans: 'x' }, { spans: [null, { ...base, name: 'scope' }] }],
					instrumentationLibrarySpans: [{ spans: [{ ...base, name: 'ignored' }] }]
				},
				{
					resource: { attributes: 'x' },
					instrumentationLibrarySpans: [{ spans: [{ ...base, name: 'legacy' }] }]
				},
				{
					resource: { attributes: [] },
					scopeSpans: 'x',
					instrumentationLibrarySpans: [{ spans: [{ ...base, name: 'fallback' }] }]
				},
				{
					resource: { attributes: [{ key: 'service.name', value: { intValue: '5' } }] },
					scopeSpans: [{ spans: [{ ...base, name: 'numeric-service' }] }]
				},
				{ resource: 'x', scopeSpans: [{ spans: [{ ...base, name: 'bad-resource' }] }] },
				{ scopeSpans: 'none' }
			]
		});
		expect(spans.map((s) => [s.name, s.serviceName, s.durationMs])).toEqual([
			['scope', 'a', 2],
			['legacy', null, 2],
			['fallback', null, 2],
			['numeric-service', 5, 2],
			['bad-resource', null, 2]
		]);
	});

	it('normalizes span identity, times, kind and status', () => {
		const spans = parseOtlpJson({
			resourceSpans: [
				{
					scopeSpans: [
						{
							spans: [
								{
									traceId: 'ABC',
									spanId: 'DEF',
									parentSpanId: 'F00',
									name: 'full',
									kind: 3,
									startTimeUnixNano: 2000000000,
									endTimeUnixNano: '2500000000',
									status: { code: 2 },
									attributes: 'nope'
								},
								{
									traceId: 1,
									spanId: null,
									parentSpanId: '',
									name: 7,
									kind: 'SPAN_KIND_UNSPECIFIED',
									status: { code: 'STATUS_CODE_ERROR' }
								},
								{
									kind: 'SERVER',
									status: { code: 'STATUS_CODE_OK' },
									startTimeUnixNano: '5000000',
									endTimeUnixNano: '1000000'
								},
								{ kind: 'bogus', status: { code: 'STATUS_CODE_UNSET' } },
								{ kind: { v: 1 }, status: 'ok' },
								{ kind: 99, status: { code: 1 } }
							]
						}
					]
				}
			]
		});
		const empty = {
			traceId: '',
			spanId: '',
			parentSpanId: null,
			name: '',
			kind: null,
			startedAt: new Date(0),
			durationMs: 0,
			status: 'unset',
			serviceName: null,
			attributes: {}
		};
		expect(spans).toEqual([
			{
				traceId: 'abc',
				spanId: 'def',
				parentSpanId: 'f00',
				name: 'full',
				kind: 'CLIENT',
				startedAt: new Date(2000),
				durationMs: 500,
				status: 'error',
				serviceName: null,
				attributes: {}
			},
			{ ...empty, status: 'error' },
			{ ...empty, kind: 'SERVER', startedAt: new Date(5), status: 'ok' },
			empty,
			empty,
			{ ...empty, status: 'ok' }
		]);
	});

	it('reads every JSON AnyValue variant', () => {
		const [s] = parseOtlpJson({
			resourceSpans: [
				{
					scopeSpans: [
						{
							spans: [
								{
									attributes: [
										null,
										{ key: 1, value: { stringValue: 'x' } },
										{ key: 's', value: { stringValue: 'v' } },
										{ key: 'both', value: { stringValue: 'wins', intValue: 1 } },
										{ key: 'b', value: { boolValue: false } },
										{ key: 'i', value: { intValue: 7 } },
										{ key: 'd', value: { doubleValue: 0.5 } },
										{
											key: 'a',
											value: {
												arrayValue: { values: [{ stringValue: 'e' }, null, { intValue: '2' }] }
											}
										},
										{ key: 'badArray', value: { arrayValue: { values: 'x' } } },
										{
											key: 'kv',
											value: {
												kvlistValue: { values: [{ key: 'k', value: { boolValue: true } }] }
											}
										},
										{ key: 'bytes', value: { bytesValue: 'AQID' } },
										{ key: 'empty', value: {} },
										{ key: 'scalar', value: 'raw' },
										{ key: 'missing' },
										{ key: 'odd', value: { intValue: null, doubleValue: 'x', stringValue: 3 } }
									]
								}
							]
						}
					]
				}
			]
		});
		expect(s.attributes).toEqual({
			s: 'v',
			both: 'wins',
			b: false,
			i: 7,
			d: 0.5,
			a: ['e', null, 2],
			badArray: null,
			kv: { k: true },
			bytes: '[bytes]',
			empty: null,
			scalar: null,
			missing: null,
			odd: null
		});
	});

	it('truncates arrays nested past the depth cap', () => {
		let value: Record<string, unknown> = { stringValue: 'leaf' };
		for (let i = 0; i < 40; i++) value = { arrayValue: { values: [value] } };
		const [s] = parseOtlpJson({
			resourceSpans: [{ scopeSpans: [{ spans: [{ attributes: [{ key: 'deep', value }] }] }] }]
		});
		let v: unknown = s.attributes.deep;
		let depth = 0;
		while (Array.isArray(v)) {
			v = v[0];
			depth++;
		}
		expect(depth).toBe(33);
		expect(v).toBe('[truncated]');
	});
});

describe('span tree', () => {
	const spans = [
		{
			spanId: 'a',
			parentSpanId: null,
			name: 'root',
			status: 'ok',
			startedAt: new Date(0),
			durationMs: 100
		},
		{
			spanId: 'b',
			parentSpanId: 'a',
			name: 'child1',
			status: 'ok',
			startedAt: new Date(10),
			durationMs: 40
		},
		{
			spanId: 'c',
			parentSpanId: 'a',
			name: 'child2',
			status: 'ok',
			startedAt: new Date(5),
			durationMs: 20
		},
		{
			spanId: 'd',
			parentSpanId: 'b',
			name: 'grandchild',
			status: 'ok',
			startedAt: new Date(12),
			durationMs: 10
		}
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
			{
				spanId: 'x',
				parentSpanId: 'gone',
				name: 'orphan',
				status: 'ok',
				startedAt: new Date(0),
				durationMs: 1
			}
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
