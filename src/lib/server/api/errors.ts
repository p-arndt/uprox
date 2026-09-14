/**
 * Error model for the admin REST API under /api.
 *
 * Every error response body has the shape `{ error: string, field?: string }`.
 * Errors thrown by the SvelteKit auth guards (`error(401 | 403, ...)`) also keep
 * the legacy `message` field SvelteKit used to send, so existing clients that read
 * it keep working.
 */
import { isHttpError, isRedirect, json, type RequestEvent } from '@sveltejs/kit';
import { isRecord } from '$lib/server/json';

export interface ApiErrorBody {
	error: string;
	field?: string;
	/** legacy alias of `error`, present on auth-guard errors only */
	message?: string;
}

/** An expected, client-caused failure with a fixed status. */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly field?: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export function badRequest(message: string, field?: string): ApiError {
	return new ApiError(400, message, field);
}

export function notFound(message = 'Not found'): ApiError {
	return new ApiError(404, message);
}

/** Postgres SQLSTATE codes that are caused by the request, not the server. */
const PG_CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
	// foreign_key_violation: e.g. a policyId that does not exist
	'23503': { status: 400, message: 'Referenced record does not exist' },
	// unique_violation
	'23505': { status: 409, message: 'Conflicts with an existing record' },
	// invalid_text_representation: e.g. a malformed uuid that slipped through
	'22P02': { status: 400, message: 'Invalid value' }
};

/** Find a Postgres SQLSTATE on the error or its `cause` chain (drizzle wraps driver errors). */
export function pgErrorCode(err: unknown): string | undefined {
	let cur: unknown = err;
	for (let depth = 0; depth < 5 && isRecord(cur); depth++) {
		if (typeof cur.code === 'string' && /^[0-9A-Z]{5}$/.test(cur.code)) return cur.code;
		cur = cur.cause;
	}
	return undefined;
}

function body(status: number, payload: ApiErrorBody): Response {
	return json(payload, { status });
}

/**
 * Map a thrown value to an error response. Known client errors become 4xx;
 * anything unexpected is logged and becomes a 500, never a 400. Redirects are
 * rethrown so SvelteKit handles them.
 */
export function errorResponse(err: unknown): Response {
	if (isRedirect(err)) throw err;
	if (err instanceof ApiError) {
		return body(
			err.status,
			err.field ? { error: err.message, field: err.field } : { error: err.message }
		);
	}
	if (isHttpError(err)) {
		const message = err.body?.message ?? 'Error';
		return body(err.status, { error: message, message });
	}
	const pg = PG_CLIENT_ERRORS[pgErrorCode(err) ?? ''];
	if (pg) return body(pg.status, { error: pg.message });

	console.error('[api] unexpected error', err);
	return body(500, { error: 'Internal server error' });
}

/**
 * Wrap an API route handler so every thrown error goes through
 * {@link errorResponse}. Handlers can then validate by throwing.
 */
export function apiHandler<E extends RequestEvent>(
	fn: (event: E) => Response | Promise<Response>
): (event: E) => Promise<Response> {
	return async (event) => {
		try {
			return await fn(event);
		} catch (err) {
			return errorResponse(err);
		}
	};
}
