import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/server/api/errors';
import {
	isUuid,
	optionalBoolean,
	optionalDate,
	optionalEnum,
	optionalNumber,
	optionalString,
	optionalStringArray,
	optionalUuid,
	pathId,
	readJson,
	requireSomeField,
	requiredNumber,
	requiredString
} from '$lib/server/api/fields';

const UUID = '3f0c1c52-8a4e-4a3b-9d0e-6a1b2c3d4e5f';

/** Run `fn` and return the ApiError it throws. */
function apiError(fn: () => unknown): ApiError {
	try {
		fn();
	} catch (err) {
		if (err instanceof ApiError) return err;
		throw err;
	}
	throw new Error('expected an ApiError');
}

function request(body: string): Request {
	return new Request('http://x/api', { method: 'POST', body });
}

describe('readJson', () => {
	it('returns a JSON object body', async () => {
		await expect(readJson(request('{"name":"a"}'))).resolves.toEqual({ name: 'a' });
	});

	it('rejects invalid JSON and non-object bodies with 400', async () => {
		for (const raw of ['{nope', '', '[1]', 'null', '"str"']) {
			await expect(readJson(request(raw))).rejects.toMatchObject({ status: 400 });
		}
	});
});

describe('requiredString', () => {
	it('returns a non-blank string', () => {
		expect(requiredString({ name: 'x' }, 'name')).toBe('x');
	});

	it('rejects missing, blank and non-string values', () => {
		for (const v of [undefined, null, '', '  ', 5]) {
			const err = apiError(() => requiredString({ name: v }, 'name'));
			expect(err).toMatchObject({ status: 400, field: 'name', message: 'name is required' });
		}
	});
});

describe('optionalString', () => {
	it('follows the tri-state convention', () => {
		expect(optionalString({}, 'a')).toBeUndefined();
		expect(optionalString({ a: null }, 'a')).toBeNull();
		expect(optionalString({ a: '' }, 'a')).toBeNull();
		expect(optionalString({ a: 'v' }, 'a')).toBe('v');
	});

	it('rejects non-strings and disallowed clears', () => {
		expect(apiError(() => optionalString({ a: 1 }, 'a')).field).toBe('a');
		expect(apiError(() => optionalString({ a: null }, 'a', { nullable: false })).message).toBe(
			'a must not be null'
		);
	});
});

describe('optionalNumber', () => {
	it('accepts numbers and numeric strings', () => {
		expect(optionalNumber({ n: 1.5 }, 'n')).toBe(1.5);
		expect(optionalNumber({ n: '12' }, 'n')).toBe(12);
		expect(optionalNumber({ n: 0 }, 'n')).toBe(0);
		expect(optionalNumber({}, 'n')).toBeUndefined();
		expect(optionalNumber({ n: null }, 'n')).toBeNull();
		expect(optionalNumber({ n: -3 }, 'n', { min: null })).toBe(-3);
	});

	it('rejects negatives, non-numbers and fractions for integers', () => {
		expect(apiError(() => optionalNumber({ n: -1 }, 'n')).message).toBe(
			'n must be a non-negative number'
		);
		expect(apiError(() => optionalNumber({ n: 'abc' }, 'n')).status).toBe(400);
		expect(apiError(() => optionalNumber({ n: true }, 'n')).status).toBe(400);
		expect(apiError(() => optionalNumber({ n: [] }, 'n')).status).toBe(400);
		expect(apiError(() => optionalNumber({ n: 1.5 }, 'n', { integer: true })).message).toBe(
			'n must be a non-negative integer'
		);
		expect(
			apiError(() => optionalNumber({ n: 1.5 }, 'n', { integer: true, min: null })).message
		).toBe('n must be an integer');
	});

	it('requiredNumber rejects absent and null', () => {
		expect(requiredNumber({ n: 2 }, 'n')).toBe(2);
		expect(apiError(() => requiredNumber({}, 'n')).message).toBe('n is required');
		expect(apiError(() => requiredNumber({ n: null }, 'n')).field).toBe('n');
	});
});

describe('optionalStringArray', () => {
	it('trims entries and drops blanks', () => {
		expect(optionalStringArray({ a: [' x ', '', 'y'] }, 'a')).toEqual(['x', 'y']);
		expect(optionalStringArray({ a: [] }, 'a')).toEqual([]);
		expect(optionalStringArray({ a: null }, 'a')).toBeNull();
		expect(optionalStringArray({}, 'a')).toBeUndefined();
	});

	it('rejects non-arrays and non-string entries', () => {
		expect(apiError(() => optionalStringArray({ a: 'x' }, 'a')).field).toBe('a');
		expect(apiError(() => optionalStringArray({ a: [1] }, 'a')).field).toBe('a');
		expect(apiError(() => optionalStringArray({ a: null }, 'a', { nullable: false })).field).toBe(
			'a'
		);
	});
});

describe('optionalBoolean', () => {
	it('accepts booleans and their string forms', () => {
		expect(optionalBoolean({ b: true }, 'b')).toBe(true);
		expect(optionalBoolean({ b: 'false' }, 'b')).toBe(false);
		expect(optionalBoolean({ b: null }, 'b')).toBeNull();
		expect(apiError(() => optionalBoolean({ b: 1 }, 'b')).field).toBe('b');
	});
});

describe('optionalEnum', () => {
	it('accepts only listed values', () => {
		expect(optionalEnum({ p: 'openai' }, 'p', ['openai', 'azure'])).toBe('openai');
		expect(apiError(() => optionalEnum({ p: 'x' }, 'p', ['openai', 'azure'])).message).toBe(
			'p must be one of: openai, azure'
		);
	});
});

describe('uuid helpers', () => {
	it('validates uuids', () => {
		expect(isUuid(UUID)).toBe(true);
		expect(isUuid('nope')).toBe(false);
		expect(optionalUuid({ id: UUID }, 'id')).toBe(UUID);
		expect(optionalUuid({ id: '' }, 'id')).toBeNull();
		expect(apiError(() => optionalUuid({ id: 'abc' }, 'id')).message).toBe('id must be a UUID');
	});

	it('pathId turns a malformed id into a 404', () => {
		expect(pathId(UUID)).toBe(UUID);
		expect(apiError(() => pathId('abc')).status).toBe(404);
		expect(apiError(() => pathId(undefined)).status).toBe(404);
	});
});

describe('optionalDate', () => {
	it('parses ISO strings and rejects garbage', () => {
		expect(optionalDate({ d: '2026-01-02T00:00:00Z' }, 'd')?.toISOString()).toBe(
			'2026-01-02T00:00:00.000Z'
		);
		expect(optionalDate({ d: null }, 'd')).toBeNull();
		expect(apiError(() => optionalDate({ d: 'soon' }, 'd')).field).toBe('d');
	});
});

describe('requireSomeField', () => {
	it('rejects an empty patch', () => {
		expect(() => requireSomeField({ a: 1 })).not.toThrow();
		expect(apiError(() => requireSomeField({})).message).toBe('No updatable fields provided');
	});
});
