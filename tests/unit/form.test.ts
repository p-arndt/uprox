import { describe, expect, it } from 'vitest';
import { isOn, parseOptionalPrice, parsePrice, parsePriority } from '$lib/server/form';

describe('isOn', () => {
	it('accepts checkbox and hidden-boolean values', () => {
		expect(isOn('on')).toBe(true);
		expect(isOn('true')).toBe(true);
		expect(isOn('false')).toBe(false);
		expect(isOn(null)).toBe(false);
	});
});

describe('parsePrice', () => {
	it('parses non-negative numbers', () => {
		expect(parsePrice(' 1.5 ')).toBe(1.5);
		expect(parsePrice('0')).toBe(0);
	});

	it('rejects negative and non-numeric values', () => {
		expect(parsePrice('-1')).toBeNull();
		expect(parsePrice('abc')).toBeNull();
		expect(parsePrice(null)).toBeNull();
	});
});

describe('parseOptionalPrice', () => {
	it('returns undefined when blank', () => {
		expect(parseOptionalPrice('')).toBeUndefined();
		expect(parseOptionalPrice('  ')).toBeUndefined();
		expect(parseOptionalPrice(null)).toBeUndefined();
	});

	it('returns the number or null for invalid input', () => {
		expect(parseOptionalPrice('0')).toBe(0);
		expect(parseOptionalPrice('2')).toBe(2);
		expect(parseOptionalPrice('-2')).toBeNull();
		expect(parseOptionalPrice('x')).toBeNull();
	});
});

describe('parsePriority', () => {
	it('parses integers and defaults to 0', () => {
		expect(parsePriority('3')).toBe(3);
		expect(parsePriority('-2')).toBe(-2);
		expect(parsePriority('')).toBe(0);
		expect(parsePriority(null)).toBe(0);
		expect(parsePriority('abc')).toBe(0);
	});
});
