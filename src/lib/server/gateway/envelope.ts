/** Client-facing error envelopes: the OpenAI shape and the native Gemini shape. */
import { json } from '@sveltejs/kit';

/** OpenAI-style error envelope, so OpenAI SDK clients parse it correctly. */
export function gatewayError(status: number, message: string, type = 'invalid_request_error') {
	return json({ error: { message, type, code: null, param: null } }, { status });
}

/**
 * Native-Gemini error envelope (`{ error: { code, message, status } }`), so the
 * Google GenAI SDK — which expects native errors, not OpenAI ones — parses a
 * gateway rejection correctly.
 */
export function geminiNativeError(status: number, message: string, googleStatus: string): Response {
	return json({ error: { code: status, message, status: googleStatus } }, { status });
}

/** Why the gateway rejected a request, independent of the wire envelope. */
export type ErrorKind =
	| 'invalid_request'
	| 'model_not_found'
	| 'permission'
	| 'insufficient_quota'
	| 'rate_limit'
	| 'upstream_misconfigured'
	| 'upstream_unavailable';

const OPENAI_ERROR_TYPES: Record<ErrorKind, string> = {
	invalid_request: 'invalid_request_error',
	model_not_found: 'model_not_found',
	permission: 'permission_error',
	insufficient_quota: 'insufficient_quota',
	rate_limit: 'rate_limit_error',
	upstream_misconfigured: 'api_error',
	upstream_unavailable: 'api_error'
};

const GOOGLE_ERROR_STATUSES: Record<ErrorKind, string> = {
	invalid_request: 'INVALID_ARGUMENT',
	model_not_found: 'INVALID_ARGUMENT',
	permission: 'PERMISSION_DENIED',
	insufficient_quota: 'RESOURCE_EXHAUSTED',
	rate_limit: 'RESOURCE_EXHAUSTED',
	upstream_misconfigured: 'FAILED_PRECONDITION',
	upstream_unavailable: 'UNAVAILABLE'
};

/**
 * Builds client-facing error responses in one ingress family's wire shape, so
 * the shared pipeline steps can reject a request without knowing whether the
 * caller is an OpenAI SDK or the Google GenAI SDK.
 */
export interface ErrorEnvelope {
	error(status: number, message: string, kind: ErrorKind): Response;
	/** 429 with a `retry-after` header (seconds, at least 1) */
	rateLimited(limit: number | undefined, retryAfterSeconds: number | undefined): Response;
}

function makeEnvelope(
	build: (status: number, message: string, kind: ErrorKind) => Response
): ErrorEnvelope {
	return {
		error: build,
		rateLimited(limit, retryAfterSeconds) {
			const res = build(429, `Rate limit exceeded: ${limit} requests/min`, 'rate_limit');
			res.headers.set('retry-after', String(retryAfterSeconds ?? 1));
			return res;
		}
	};
}

export const openAiEnvelope: ErrorEnvelope = makeEnvelope((status, message, kind) =>
	gatewayError(status, message, OPENAI_ERROR_TYPES[kind])
);

export const geminiEnvelope: ErrorEnvelope = makeEnvelope((status, message, kind) =>
	geminiNativeError(status, message, GOOGLE_ERROR_STATUSES[kind])
);
