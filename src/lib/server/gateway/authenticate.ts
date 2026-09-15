/** Gateway authentication and the request headers the gateway reads. */
import type { RequestEvent } from '@sveltejs/kit';
import { resolveToken, type ResolvedToken } from '$lib/server/tokens';
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
