/**
 * Dependency-free decoder for OTLP `ExportTraceServiceRequest` payloads, in both
 * OTLP/HTTP wire formats: protobuf (the OpenInference/OTel exporter default) and
 * JSON. We deliberately avoid an OTel SDK dependency — the proto subset uprox
 * needs is small and its field numbers are stable — and decode the protobuf wire
 * format directly into the flat {@link ParsedSpan} rows the trace store uses.
 *
 * Only the fields the trace viewer renders are read; everything else is skipped.
 */

export interface ParsedSpan {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	name: string;
	/** OTLP span kind name (INTERNAL | SERVER | CLIENT | PRODUCER | CONSUMER) */
	kind: string | null;
	startedAt: Date;
	durationMs: number;
	status: 'ok' | 'error' | 'unset';
	serviceName: string | null;
	/** flattened attributes (OpenInference keys etc.) */
	attributes: Record<string, unknown>;
}

const SPAN_KINDS = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];

function kindName(kind: number | null): string | null {
	if (kind == null || kind <= 0) return null;
	return SPAN_KINDS[kind] ?? null;
}

function statusName(code: number): 'ok' | 'error' | 'unset' {
	return code === 1 ? 'ok' : code === 2 ? 'error' : 'unset';
}

/** nanoseconds (bigint) → Date (ms) and a ms duration that stays within Number range. */
function span(startNs: bigint, endNs: bigint): { startedAt: Date; durationMs: number } {
	const startedAt = new Date(Number(startNs / 1_000_000n));
	const durationMs = endNs > startNs ? Number((endNs - startNs) / 1_000_000n) : 0;
	return { startedAt, durationMs };
}

/* ------------------------------ protobuf wire ------------------------------ */

/** Minimal protobuf wire reader (varint / fixed64 / length-delimited / fixed32). */
class Reader {
	private pos = 0;
	constructor(private readonly buf: Uint8Array) {}

	get eof(): boolean {
		return this.pos >= this.buf.length;
	}

	varint(): bigint {
		let result = 0n;
		let shift = 0n;
		for (;;) {
			const b = this.buf[this.pos++];
			result |= BigInt(b & 0x7f) << shift;
			if ((b & 0x80) === 0) break;
			shift += 7n;
		}
		return result;
	}

	bytes(): Uint8Array {
		const len = Number(this.varint());
		const out = this.buf.subarray(this.pos, this.pos + len);
		this.pos += len;
		return out;
	}

	fixed64(): bigint {
		let v = 0n;
		for (let i = 0; i < 8; i++) v |= BigInt(this.buf[this.pos++]) << BigInt(8 * i);
		return v;
	}

	/** Advance past a field whose value we don't care about. */
	skip(wireType: number): void {
		if (wireType === 0) this.varint();
		else if (wireType === 1) this.pos += 8;
		else if (wireType === 2) this.pos += Number(this.varint());
		else if (wireType === 5) this.pos += 4;
		else throw new Error(`unsupported wire type ${wireType}`);
	}
}

function toHex(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}

const utf8 = new TextDecoder();

function readDouble(bits: bigint): number {
	const dv = new DataView(new ArrayBuffer(8));
	dv.setBigUint64(0, bits, true);
	return dv.getFloat64(0, true);
}

/** Decode an OTLP `AnyValue` to a plain JS scalar/array/object. */
function decodeAnyValue(buf: Uint8Array): unknown {
	const r = new Reader(buf);
	while (!r.eof) {
		const tag = Number(r.varint());
		const no = tag >>> 3;
		const ty = tag & 7;
		switch (no) {
			case 1:
				return utf8.decode(r.bytes());
			case 2:
				return r.varint() !== 0n;
			case 3:
				return Number(BigInt.asIntN(64, r.varint()));
			case 4:
				return readDouble(r.fixed64());
			case 5: {
				// ArrayValue { repeated AnyValue values = 1 }
				const ar = new Reader(r.bytes());
				const arr: unknown[] = [];
				while (!ar.eof) {
					const t = Number(ar.varint());
					if (t >>> 3 === 1) arr.push(decodeAnyValue(ar.bytes()));
					else ar.skip(t & 7);
				}
				return arr;
			}
			case 6:
				return decodeKvList(r.bytes());
			case 7:
				r.bytes();
				return '[bytes]';
			default:
				r.skip(ty);
		}
	}
	return null;
}

/** Decode a list of OTLP `KeyValue` into a plain object. */
function decodeKvList(buf: Uint8Array): Record<string, unknown> {
	const r = new Reader(buf);
	const out: Record<string, unknown> = {};
	while (!r.eof) {
		const tag = Number(r.varint());
		if (tag >>> 3 === 1) {
			const [k, v] = decodeKeyValue(r.bytes());
			if (k) out[k] = v;
		} else r.skip(tag & 7);
	}
	return out;
}

function decodeKeyValue(buf: Uint8Array): [string, unknown] {
	const r = new Reader(buf);
	let key = '';
	let value: unknown = null;
	while (!r.eof) {
		const tag = Number(r.varint());
		const no = tag >>> 3;
		const ty = tag & 7;
		if (no === 1) key = utf8.decode(r.bytes());
		else if (no === 2) value = decodeAnyValue(r.bytes());
		else r.skip(ty);
	}
	return [key, value];
}

function decodeStatusCode(buf: Uint8Array): number {
	const r = new Reader(buf);
	let code = 0;
	while (!r.eof) {
		const tag = Number(r.varint());
		const no = tag >>> 3;
		const ty = tag & 7;
		if (no === 3) code = Number(r.varint());
		else r.skip(ty);
	}
	return code;
}

function decodeSpan(buf: Uint8Array, serviceName: string | null): ParsedSpan {
	const r = new Reader(buf);
	let traceId = '';
	let spanId = '';
	let parentSpanId = '';
	let name = '';
	let kind: number | null = null;
	let startNs = 0n;
	let endNs = 0n;
	let status: 'ok' | 'error' | 'unset' = 'unset';
	const attributes: Record<string, unknown> = {};

	while (!r.eof) {
		const tag = Number(r.varint());
		const no = tag >>> 3;
		const ty = tag & 7;
		switch (no) {
			case 1:
				traceId = toHex(r.bytes());
				break;
			case 2:
				spanId = toHex(r.bytes());
				break;
			case 4:
				parentSpanId = toHex(r.bytes());
				break;
			case 5:
				name = utf8.decode(r.bytes());
				break;
			case 6:
				kind = Number(r.varint());
				break;
			case 7:
				startNs = r.fixed64();
				break;
			case 8:
				endNs = r.fixed64();
				break;
			case 9: {
				const [k, v] = decodeKeyValue(r.bytes());
				if (k) attributes[k] = v;
				break;
			}
			case 15:
				status = statusName(decodeStatusCode(r.bytes()));
				break;
			default:
				r.skip(ty);
		}
	}

	return {
		traceId,
		spanId,
		parentSpanId: parentSpanId || null,
		name,
		kind: kindName(kind),
		...span(startNs, endNs),
		status,
		serviceName,
		attributes
	};
}

function resourceServiceName(buf: Uint8Array): string | null {
	const r = new Reader(buf);
	let name: string | null = null;
	while (!r.eof) {
		const tag = Number(r.varint());
		if (tag >>> 3 === 1) {
			const [k, v] = decodeKeyValue(r.bytes());
			if (k === 'service.name' && typeof v === 'string') name = v;
		} else r.skip(tag & 7);
	}
	return name;
}

function parseScopeSpans(buf: Uint8Array, serviceName: string | null, out: ParsedSpan[]): void {
	const r = new Reader(buf);
	while (!r.eof) {
		const tag = Number(r.varint());
		// ScopeSpans { scope = 1, repeated Span spans = 2 }
		if (tag >>> 3 === 2) out.push(decodeSpan(r.bytes(), serviceName));
		else r.skip(tag & 7);
	}
}

function parseResourceSpans(buf: Uint8Array, out: ParsedSpan[]): void {
	const r = new Reader(buf);
	let serviceName: string | null = null;
	const scopeBufs: Uint8Array[] = [];
	// fields may arrive in any order; buffer scope_spans, resolve resource first
	while (!r.eof) {
		const tag = Number(r.varint());
		const no = tag >>> 3;
		const ty = tag & 7;
		if (no === 1) serviceName = resourceServiceName(r.bytes());
		else if (no === 2) scopeBufs.push(r.bytes().slice());
		else r.skip(ty);
	}
	for (const sb of scopeBufs) parseScopeSpans(sb, serviceName, out);
}

/** Decode a binary OTLP/HTTP `ExportTraceServiceRequest` (protobuf) into spans. */
export function parseOtlpProtobuf(buf: Uint8Array): ParsedSpan[] {
	const out: ParsedSpan[] = [];
	const r = new Reader(buf);
	while (!r.eof) {
		const tag = Number(r.varint());
		// ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1 }
		if (tag >>> 3 === 1) parseResourceSpans(r.bytes().slice(), out);
		else r.skip(tag & 7);
	}
	return out;
}

/* --------------------------------- JSON ---------------------------------- */

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read an OTLP/JSON `AnyValue` object (`{ stringValue }`, `{ intValue }`, …). */
function jsonAnyValue(v: unknown): unknown {
	if (!isRecord(v)) return null;
	if (typeof v.stringValue === 'string') return v.stringValue;
	if (typeof v.boolValue === 'boolean') return v.boolValue;
	if (v.intValue != null) return Number(v.intValue);
	if (typeof v.doubleValue === 'number') return v.doubleValue;
	if (isRecord(v.arrayValue) && Array.isArray(v.arrayValue.values))
		return v.arrayValue.values.map(jsonAnyValue);
	if (isRecord(v.kvlistValue) && Array.isArray(v.kvlistValue.values))
		return jsonAttributes(v.kvlistValue.values);
	if (v.bytesValue != null) return '[bytes]';
	return null;
}

function jsonAttributes(list: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (!Array.isArray(list)) return out;
	for (const kv of list) {
		if (isRecord(kv) && typeof kv.key === 'string') out[kv.key] = jsonAnyValue(kv.value);
	}
	return out;
}

function jsonKind(kind: unknown): number | null {
	if (typeof kind === 'number') return kind;
	if (typeof kind === 'string') {
		const idx = SPAN_KINDS.indexOf(kind.replace(/^SPAN_KIND_/, ''));
		return idx >= 0 ? idx : null;
	}
	return null;
}

function jsonStatusCode(status: unknown): number {
	if (!isRecord(status)) return 0;
	const code = status.code;
	if (typeof code === 'number') return code;
	if (code === 'STATUS_CODE_OK') return 1;
	if (code === 'STATUS_CODE_ERROR') return 2;
	return 0;
}

/** Decode an OTLP/HTTP `ExportTraceServiceRequest` (JSON) into spans. */
export function parseOtlpJson(payload: unknown): ParsedSpan[] {
	const out: ParsedSpan[] = [];
	if (!isRecord(payload) || !Array.isArray(payload.resourceSpans)) return out;
	for (const rs of payload.resourceSpans) {
		if (!isRecord(rs)) continue;
		const serviceName =
			isRecord(rs.resource) && Array.isArray(rs.resource.attributes)
				? ((jsonAttributes(rs.resource.attributes)['service.name'] as string) ?? null)
				: null;
		const scopeSpans = Array.isArray(rs.scopeSpans)
			? rs.scopeSpans
			: Array.isArray(rs.instrumentationLibrarySpans)
				? rs.instrumentationLibrarySpans
				: [];
		for (const ss of scopeSpans) {
			if (!isRecord(ss) || !Array.isArray(ss.spans)) continue;
			for (const sp of ss.spans) {
				if (!isRecord(sp)) continue;
				const startNs = BigInt(String(sp.startTimeUnixNano ?? '0'));
				const endNs = BigInt(String(sp.endTimeUnixNano ?? '0'));
				out.push({
					traceId: typeof sp.traceId === 'string' ? sp.traceId.toLowerCase() : '',
					spanId: typeof sp.spanId === 'string' ? sp.spanId.toLowerCase() : '',
					parentSpanId:
						typeof sp.parentSpanId === 'string' && sp.parentSpanId
							? sp.parentSpanId.toLowerCase()
							: null,
					name: typeof sp.name === 'string' ? sp.name : '',
					kind: kindName(jsonKind(sp.kind)),
					...span(startNs, endNs),
					status: statusName(jsonStatusCode(sp.status)),
					serviceName,
					attributes: jsonAttributes(sp.attributes)
				});
			}
		}
	}
	return out;
}
