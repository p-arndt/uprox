/**
 * OTLP/HTTP protobuf reader: a minimal hand-rolled wire decoder for
 * `ExportTraceServiceRequest` → {@link ParsedSpan} rows. Only the fields the
 * trace viewer renders are read; everything else is skipped.
 */
import { MAX_DEPTH, kindName, spanTiming, statusName, type ParsedSpan } from './span';

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
			// past the end reads as 0, which terminates the varint
			const b = this.buf[this.pos++] ?? 0;
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
		for (let i = 0; i < 8; i++) {
			const byte = this.buf[this.pos++];
			if (byte === undefined) throw new RangeError('fixed64 reads past the end of the buffer');
			v |= BigInt(byte) << BigInt(8 * i);
		}
		return v;
	}

	/** Advance past a field whose value we don't care about. */
	skip(wireType: number): void {
		if (wireType === 0) this.varint();
		else if (wireType === 1) this.pos += 8;
		else if (wireType === 2) {
			// read the length before advancing: `this.pos += this.varint()` would add
			// the length to the position *before* the varint moved past its prefix
			const len = Number(this.varint());
			this.pos += len;
		} else if (wireType === 5) this.pos += 4;
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

/** Decode an OTLP `ArrayValue { repeated AnyValue values = 1 }`. */
function decodeArrayValue(buf: Uint8Array, depth: number): unknown[] {
	const r = new Reader(buf);
	const arr: unknown[] = [];
	while (!r.eof) {
		const t = Number(r.varint());
		if (t >>> 3 === 1) arr.push(decodeAnyValue(r.bytes(), depth + 1));
		else r.skip(t & 7);
	}
	return arr;
}

/** Decode an OTLP `AnyValue` to a plain JS scalar/array/object. */
function decodeAnyValue(buf: Uint8Array, depth = 0): unknown {
	// Stop descending once nesting exceeds the cap, so a deeply nested AnyValue
	// can't overflow the stack. Scalars below are still safe to read.
	if (depth > MAX_DEPTH) return '[truncated]';
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
			case 5:
				return decodeArrayValue(r.bytes(), depth);
			case 6:
				return decodeKvList(r.bytes(), depth + 1);
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
function decodeKvList(buf: Uint8Array, depth = 0): Record<string, unknown> {
	if (depth > MAX_DEPTH) return {};
	const r = new Reader(buf);
	const out: Record<string, unknown> = {};
	while (!r.eof) {
		const tag = Number(r.varint());
		if (tag >>> 3 === 1) {
			const [k, v] = decodeKeyValue(r.bytes(), depth);
			if (k) out[k] = v;
		} else r.skip(tag & 7);
	}
	return out;
}

function decodeKeyValue(buf: Uint8Array, depth = 0): [string, unknown] {
	const r = new Reader(buf);
	let key = '';
	let value: unknown = null;
	while (!r.eof) {
		const tag = Number(r.varint());
		const no = tag >>> 3;
		const ty = tag & 7;
		if (no === 1) key = utf8.decode(r.bytes());
		else if (no === 2) value = decodeAnyValue(r.bytes(), depth + 1);
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
		...spanTiming(startNs, endNs),
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
