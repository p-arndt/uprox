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
		if ((event.request.headers.get('content-encoding') ?? '').includes('gzip')) {
			raw = new Uint8Array(gunzipSync(raw));
		}
	} catch {
		return gatewayError(400, 'Could not read request body');
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
