/** OTLP/HTTP JSON reader: `ExportTraceServiceRequest` JSON → {@link ParsedSpan} rows. */
import { isRecord } from '$lib/server/json';
import { MAX_DEPTH, SPAN_KINDS, kindName, spanTiming, statusName, type ParsedSpan } from './span';

/** Read an OTLP/JSON `AnyValue` object (`{ stringValue }`, `{ intValue }`, …). */
function jsonAnyValue(v: unknown, depth = 0): unknown {
	// Same depth cap as the protobuf path: a deeply nested JSON AnyValue recurses
	// too, so bail out before the stack overflows.
	if (depth > MAX_DEPTH) return '[truncated]';
	if (!isRecord(v)) return null;
	if (typeof v.stringValue === 'string') return v.stringValue;
	if (typeof v.boolValue === 'boolean') return v.boolValue;
	if (v.intValue != null) return Number(v.intValue);
	if (typeof v.doubleValue === 'number') return v.doubleValue;
	if (isRecord(v.arrayValue) && Array.isArray(v.arrayValue.values))
		return v.arrayValue.values.map((e) => jsonAnyValue(e, depth + 1));
	if (isRecord(v.kvlistValue) && Array.isArray(v.kvlistValue.values))
		return jsonAttributes(v.kvlistValue.values, depth + 1);
	if (v.bytesValue != null) return '[bytes]';
	return null;
}

function jsonAttributes(list: unknown, depth = 0): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (depth > MAX_DEPTH) return out;
	if (!Array.isArray(list)) return out;
	for (const kv of list) {
		if (isRecord(kv) && typeof kv.key === 'string') out[kv.key] = jsonAnyValue(kv.value, depth);
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

/** A lower-cased hex id, or '' when the field isn't a string. */
function jsonId(v: unknown): string {
	return typeof v === 'string' ? v.toLowerCase() : '';
}

/** `resource.attributes['service.name']`, or null when absent. */
function jsonServiceName(resource: unknown): string | null {
	if (!isRecord(resource) || !Array.isArray(resource.attributes)) return null;
	return (jsonAttributes(resource.attributes)['service.name'] as string) ?? null;
}

/** A ResourceSpans' scope spans, accepting the pre-1.0 `instrumentationLibrarySpans` name. */
function jsonScopeSpans(rs: Record<string, unknown>): unknown[] {
	if (Array.isArray(rs.scopeSpans)) return rs.scopeSpans;
	if (Array.isArray(rs.instrumentationLibrarySpans)) return rs.instrumentationLibrarySpans;
	return [];
}

function jsonSpan(sp: Record<string, unknown>, serviceName: string | null): ParsedSpan {
	const startNs = BigInt(String(sp.startTimeUnixNano ?? '0'));
	const endNs = BigInt(String(sp.endTimeUnixNano ?? '0'));
	return {
		traceId: jsonId(sp.traceId),
		spanId: jsonId(sp.spanId),
		parentSpanId: jsonId(sp.parentSpanId) || null,
		name: typeof sp.name === 'string' ? sp.name : '',
		kind: kindName(jsonKind(sp.kind)),
		...spanTiming(startNs, endNs),
		status: statusName(jsonStatusCode(sp.status)),
		serviceName,
		attributes: jsonAttributes(sp.attributes)
	};
}

/** Decode an OTLP/HTTP `ExportTraceServiceRequest` (JSON) into spans. */
export function parseOtlpJson(payload: unknown): ParsedSpan[] {
	const out: ParsedSpan[] = [];
	if (!isRecord(payload) || !Array.isArray(payload.resourceSpans)) return out;
	for (const rs of payload.resourceSpans) {
		if (!isRecord(rs)) continue;
		const serviceName = jsonServiceName(rs.resource);
		for (const ss of jsonScopeSpans(rs)) {
			if (!isRecord(ss) || !Array.isArray(ss.spans)) continue;
			for (const sp of ss.spans) {
				if (isRecord(sp)) out.push(jsonSpan(sp, serviceName));
			}
		}
	}
	return out;
}
