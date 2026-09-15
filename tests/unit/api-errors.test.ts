import { afterEach, describe, expect, it, vi } from 'vitest';
import { error, redirect } from '@sveltejs/kit';
import {
	ApiError,
	apiHandler,
	badRequest,
	errorResponse,
	notFound,
	pgErrorCode
} from '$lib/server/api/errors';

async function parse(res: Response) {
	return { status: res.status, body: await res.json() };
}

function thrown(fn: () => never): unknown {
	try {
		fn();
	} catch (err) {
		return err;
	}
}

afterEach(() => vi.restoreAllMocks());

describe('errorResponse', () => {
	it('maps ApiError to its status with error and field', async () => {
		expect(await parse(errorResponse(badRequest('name is required', 'name')))).toEqual({
			status: 400,
			body: { error: 'name is required', field: 'name' }
		});
		expect(await parse(errorResponse(notFound()))).toEqual({
			status: 404,
			body: { error: 'Not found' }
		});
		expect(await parse(errorResponse(new ApiError(409, 'taken')))).toEqual({
			status: 409,
			body: { error: 'taken' }
		});
	});

	it('maps auth-guard HttpErrors, keeping the legacy message field', async () => {
		const err = thrown(() => error(403, 'You do not have permission to perform this action'));
		expect(await parse(errorResponse(err))).toEqual({
			status: 403,
			body: {
				error: 'You do not have permission to perform this action',
				message: 'You do not have permission to perform this action'
			}
		});
	});

	it('rethrows redirects', () => {
		const err = thrown(() => redirect(302, '/login'));
		expect(() => errorResponse(err)).toThrow();
	});

	it('maps client-caused Postgres errors found on the cause chain', async () => {
		const wrapped = new Error('Failed query', { cause: { code: '23503' } });
		expect(await parse(errorResponse(wrapped))).toEqual({
			status: 400,
			body: { error: 'Referenced record does not exist' }
		});
		expect((await parse(errorResponse({ code: '23505' }))).status).toBe(409);
		expect((await parse(errorResponse({ code: '22P02' }))).status).toBe(400);
	});

	it('turns unexpected errors into a logged 500, never a 400', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const boom = new Error('audit insert failed');
		expect(await parse(errorResponse(boom))).toEqual({
			status: 500,
			body: { error: 'Internal server error' }
		});
		expect(log).toHaveBeenCalledWith('[api] unexpected error', boom);
		// a non-client SQLSTATE is still a server error
		expect((await parse(errorResponse({ code: '57014' }))).status).toBe(500);
	});
});

describe('pgErrorCode', () => {
	it('reads a SQLSTATE from the error or its causes', () => {
		expect(pgErrorCode({ code: '23505' })).toBe('23505');
		expect(
			pgErrorCode(new Error('x', { cause: new Error('y', { cause: { code: '22P02' } }) }))
		).toBe('22P02');
		expect(pgErrorCode(new Error('plain'))).toBeUndefined();
		expect(pgErrorCode({ code: 'ECONNREFUSED' })).toBeUndefined();
	});
});

describe('apiHandler', () => {
	it('passes successful responses through', async () => {
		const handler = apiHandler(async () => new Response(null, { status: 204 }));
		expect((await handler({} as never)).status).toBe(204);
	});

	it('converts thrown errors into responses', async () => {
		const handler = apiHandler(() => {
			throw badRequest('bad', 'x');
		});
		expect(await parse(await handler({} as never))).toEqual({
			status: 400,
			body: { error: 'bad', field: 'x' }
		});
	});
});
