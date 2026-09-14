/** Gateway authentication and the request headers the gateway reads. */
import type { RequestEvent } from '@sveltejs/kit';
import { resolveToken, type ResolvedToken } from '$lib/server/tokens';
import { parseTraceparent, parseTraceMetadata } from '$lib/features/traces/trace';
import { gatewayError } from './envelope';

/**
 * Read the caller's machine token. Accepts
 *   `Authorization: Bearer <token>` (OpenAI SDK shape),
 *   `api-key: <token>` (Azure OpenAI SDK shape), or
 *   `x-goog-api-key: <token>` (Google GenAI SDK shape, used by native ingress),
 * so the same uprox instance can sit behind clients of all three ecosystems.
 */
function readApiKey(event: RequestEvent): string | null {
	const header = event.request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	if (match) return (match[1] ?? '').trim();
	const apiKey = event.request.headers.get('api-key')?.trim();
	if (apiKey) return apiKey;
	const goog = event.request.headers.get('x-goog-api-key')?.trim();
	return goog ? goog : null;
}

/**
 * Read the caller's session/correlation id for trace grouping. Lets the several
 * gateway calls of one logical run — e.g. a tool-use loop — collapse into a
 * single timeline in the trace viewer.
 *
 * Resolution order, so grouping needs *no* client changes in the common case:
 *   1. `x-uprox-trace-id` / `x-uprox-session-id` — explicit opt-in / override.
 *   2. W3C `traceparent` — every OpenTelemetry-instrumented client already sends
 *      this; we extract its 32-hex trace-id. This is also the id uprox shares
 *      with the app's own OTLP spans, so the two stitch into one trace.
 * Returns null when none is present (the call is traced, just not grouped).
 */
export function readTraceGroup(event: RequestEvent): string | null {
	const explicit =
		event.request.headers.get('x-uprox-trace-id') ??
		event.request.headers.get('x-uprox-session-id');
	const trimmed = explicit?.trim();
	if (trimmed) return trimmed.slice(0, 200);

	return parseTraceparent(event.request.headers.get('traceparent'));
}

/**
 * Read caller-supplied trace metadata — free-form key/values attached to the
 * trace (the OpenInference `metadata` equivalent): a chat id, end-user id,
 * tenant, experiment, tags, anything. Two sources, merged:
 *   - `x-uprox-metadata`: a JSON object header (richest; nested values allowed).
 *   - `x-uprox-meta-<key>: <value>`: one header per key (string values).
 * Returns null when nothing was sent. Deliberately generic — uprox never
 * special-cases particular keys.
 */
export function readTraceMetadata(event: RequestEvent): Record<string, unknown> | null {
	return parseTraceMetadata(event.request.headers.get('x-uprox-metadata'), event.request.headers);
}

export interface GatewayAuth {
	token: ResolvedToken;
	ip: string;
}

/**
 * Authenticate a gateway request via its machine token. Returns either the
 * resolved token context or a ready-to-return error Response.
 */
export async function authenticateGateway(
	event: RequestEvent
): Promise<{ ok: true; auth: GatewayAuth } | { ok: false; response: Response }> {
	const raw = readApiKey(event);
	if (!raw) {
		return { ok: false, response: gatewayError(401, 'Missing API key', 'authentication_error') };
	}
	const token = await resolveToken(raw);
	if (!token) {
		return {
			ok: false,
			response: gatewayError(401, 'Invalid or revoked API key', 'authentication_error')
		};
	}
	return { ok: true, auth: { token, ip: event.getClientAddress() } };
}
