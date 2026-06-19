import { gunzipSync } from 'node:zlib';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGateway, gatewayError } from '$lib/server/gateway';
import { parseOtlpProtobuf, parseOtlpJson, type ParsedSpan } from '$lib/server/otlp/decode';
import { recordSpans } from '$lib/server/trace';
import { getSettings } from '$lib/server/data';

/**
 * OTLP/HTTP trace ingest — the standard OTel collector path. Client apps point
 * their OpenInference/OpenTelemetry exporter here (with the uprox token as the
 * Authorization bearer) and uprox stores their spans so the trace viewer can
 * render the full nested tree the proxy can't observe on its own. Accepts both
 * wire formats: protobuf (`application/x-protobuf`, the exporter default) and
 * JSON (`application/json`), gzip-decoding the body when so encoded.
 *
 * Auth is the same machine token as the gateway. Ingest is gated by the instance
 * tracing switch: when tracing is off we accept and drop (200), so a misconfigured
 * exporter doesn't spew errors.
 */

// DoS guards. A legitimate OTLP export batch is small (a few KB to low hundreds
// of KB); these ceilings sit comfortably above that while denying abusive cases.
//   - MAX_COMPRESSED_BYTES caps the on-the-wire body we buffer (gzip or not), so
//     a single request can't pin unbounded memory.
//   - MAX_DECOMPRESSED_BYTES caps the gzip *inflation* (decompression bomb) and
//     an uncompressed oversized body, so a tiny gzip body can't expand to GBs.
const MAX_COMPRESSED_BYTES = 5_000_000; // 5 MB on-the-wire ceiling
const MAX_DECOMPRESSED_BYTES = 50_000_000; // 50 MB post-inflation ceiling

export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) return auth.response;

	const settings = await getSettings();
	const contentType = event.request.headers.get('content-type') ?? '';
	const isProtobuf = contentType.includes('protobuf');

	// Accept-and-drop when tracing is disabled instance-wide, in the format the
	// exporter expects, so it sees success and backs off cleanly.
	if (!settings.tracingEnabled) return ok(isProtobuf);

	let raw: Uint8Array;
	try {
		raw = new Uint8Array(await event.request.arrayBuffer());
	} catch {
		return gatewayError(400, 'Could not read request body');
	}

	// Reject an oversized on-the-wire body before doing any further work, so a
	// single request can't pin unbounded memory.
	if (raw.byteLength > MAX_COMPRESSED_BYTES) {
		return gatewayError(413, 'Payload too large');
	}

	if ((event.request.headers.get('content-encoding') ?? '').includes('gzip')) {
		try {
			// Bound the inflation: Node throws (ERR_BUFFER_TOO_LARGE) once the
			// decompressed output would exceed maxOutputLength, defeating a gzip bomb.
			raw = new Uint8Array(gunzipSync(raw, { maxOutputLength: MAX_DECOMPRESSED_BYTES }));
		} catch {
			// Either a corrupt gzip stream or an over-the-cap inflation; both are
			// safe to surface as "too large" — we never let the throw escape.
			return gatewayError(413, 'Payload too large');
		}
	} else if (raw.byteLength > MAX_DECOMPRESSED_BYTES) {
		// An uncompressed oversized body never passes the decompression cap above,
		// so guard the JSON/protobuf path explicitly before parsing.
		return gatewayError(413, 'Payload too large');
	}

	let spans: ParsedSpan[];
	try {
		if (isProtobuf) {
			spans = parseOtlpProtobuf(raw);
		} else {
			spans = parseOtlpJson(JSON.parse(new TextDecoder().decode(raw)));
		}
	} catch {
		return gatewayError(400, 'Malformed OTLP payload');
	}

	await recordSpans(spans, auth.auth.token.serviceId);
	return ok(isProtobuf);
};

/**
 * OTLP success response. A bare 200 with an empty `ExportTraceServiceResponse`
 * (no partial_success) is what exporters expect; for protobuf that serializes to
 * an empty body, for JSON to `{}`.
 */
function ok(isProtobuf: boolean): Response {
	if (isProtobuf) {
		return new Response(new Uint8Array(0), {
			status: 200,
			headers: { 'content-type': 'application/x-protobuf' }
		});
	}
	return json({});
}
