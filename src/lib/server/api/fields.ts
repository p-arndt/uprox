/**
 * Request body reading and typed field validators for the admin REST API.
 *
 * Validators throw an {@link ApiError} (400, with `field`) on invalid input, so
 * route handlers wrapped in `apiHandler` can call them inline.
 *
 * Optional validators share one tri-state convention: an absent key returns
 * `undefined` ("leave unchanged" / "use the default"), an explicit `null` (or
 * `''` for scalars) returns `null` ("clear"), anything else must be valid.
 * Pass `{ nullable: false }` for columns that cannot be cleared.
 */
import { isRecord } from '$lib/server/json';
import { badRequest, notFound } from '$lib/server/api/errors';

export type JsonBody = Record<string, unknown>;

interface Nullable {
	nullable?: boolean;
}

/** Parse the request body as a JSON object; 400 on invalid JSON or a non-object. */
export async function readJson(request: Request): Promise<JsonBody> {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		throw badRequest('Request body must be valid JSON');
	}
	if (!isRecord(parsed)) throw badRequest('Request body must be a JSON object');
	return parsed;
}

/** Returns null for an explicit clear, or throws when clearing is not allowed. */
function cleared(key: string, opts: Nullable): null {
	if (opts.nullable === false) throw badRequest(`${key} must not be null`, key);
	return null;
}

/** A required, non-blank string. Returned untrimmed. */
export function requiredString(body: JsonBody, key: string): string {
	const v = body[key];
	if (typeof v !== 'string' || v.trim() === '') throw badRequest(`${key} is required`, key);
	return v;
}

export function optionalString(
	body: JsonBody,
	key: string,
	opts: Nullable = {}
): string | null | undefined {
	const v = body[key];
	if (v === undefined) return undefined;
	if (v === null || v === '') return cleared(key, opts);
	if (typeof v !== 'string') throw badRequest(`${key} must be a string`, key);
	return v;
}

/**
 * A number (or numeric string, for form-style clients). `min` defaults to 0;
 * `integer` rejects fractions for integer columns.
 */
export function optionalNumber(
	body: JsonBody,
	key: string,
	opts: Nullable & { min?: number | null; integer?: boolean } = {}
): number | null | undefined {
	const v = body[key];
	if (v === undefined) return undefined;
	if (v === null || v === '') return cleared(key, opts);
	const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
	const min = opts.min === undefined ? 0 : opts.min;
	if (!Number.isFinite(n) || (opts.integer && !Number.isInteger(n)) || (min !== null && n < min)) {
		const kind = opts.integer ? 'integer' : 'number';
		const expected =
			min === 0 ? `a non-negative ${kind}` : opts.integer ? 'an integer' : 'a number';
		throw badRequest(`${key} must be ${expected}`, key);
	}
	return n;
}

export function requiredNumber(
	body: JsonBody,
	key: string,
	opts: { min?: number | null; integer?: boolean } = {}
): number {
	const n = optionalNumber(body, key, { ...opts, nullable: false });
	if (n === undefined || n === null) throw badRequest(`${key} is required`, key);
	return n;
}

/** An array of strings; entries are trimmed and blanks dropped. */
export function optionalStringArray(
	body: JsonBody,
	key: string,
	opts: Nullable = {}
): string[] | null | undefined {
	const v = body[key];
	if (v === undefined) return undefined;
	if (v === null) return cleared(key, opts);
	if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
		throw badRequest(`${key} must be an array of strings`, key);
	}
	return v.map((x) => x.trim()).filter(Boolean);
}

/** `true`/`false` (also the strings `'true'`/`'false'`). */
export function optionalBoolean(
	body: JsonBody,
	key: string,
	opts: Nullable = {}
): boolean | null | undefined {
	const v = body[key];
	if (v === undefined) return undefined;
	if (v === null || v === '') return cleared(key, opts);
	if (v === true || v === 'true') return true;
	if (v === false || v === 'false') return false;
	throw badRequest(`${key} must be a boolean`, key);
}

export function optionalEnum<T extends string>(
	body: JsonBody,
	key: string,
	values: readonly T[],
	opts: Nullable = {}
): T | null | undefined {
	const v = body[key];
	if (v === undefined) return undefined;
	if (v === null || v === '') return cleared(key, opts);
	if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
		throw badRequest(`${key} must be one of: ${values.join(', ')}`, key);
	}
	return v as T;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
	return typeof v === 'string' && UUID_RE.test(v);
}

export function optionalUuid(
	body: JsonBody,
	key: string,
	opts: Nullable = {}
): string | null | undefined {
	const v = body[key];
	if (v === undefined) return undefined;
	if (v === null || v === '') return cleared(key, opts);
	if (!isUuid(v)) throw badRequest(`${key} must be a UUID`, key);
	return v;
}

/** An ISO date string or epoch milliseconds. */
export function optionalDate(
	body: JsonBody,
	key: string,
	opts: Nullable = {}
): Date | null | undefined {
	const v = body[key];
	if (v === undefined) return undefined;
	if (v === null || v === '') return cleared(key, opts);
	const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
	if (!d || Number.isNaN(d.getTime())) throw badRequest(`${key} must be a date`, key);
	return d;
}

/** A route `[id]` param. A malformed id cannot match any row, so it is a 404. */
export function pathId(id: string | undefined): string {
	if (!isUuid(id)) throw notFound();
	return id;
}

/** Reject a PATCH that carries none of the route's accepted fields. */
export function requireSomeField(patch: object): void {
	if (Object.keys(patch).length === 0) throw badRequest('No updatable fields provided');
}
