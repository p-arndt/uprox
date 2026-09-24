import { describe, expect, it } from 'vitest';
import {
	modelPatternError,
	modelPatternsError,
	patternMatchesKnown,
	unknownModelPatterns
} from '$lib/model-patterns';
import { addModelPatterns, splitModelPatterns } from '$lib/features/policies/model-pattern-chips';

const KNOWN = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6', 'gpt-5.4-mini'];

describe('modelPatternError', () => {
	it('accepts exact ids and a trailing prefix glob', () => {
		expect(modelPatternError('gpt-4o')).toBeNull();
		expect(modelPatternError('gpt-4o*')).toBeNull();
		expect(modelPatternError('*')).toBeNull();
	});

	it('rejects a * anywhere but the end', () => {
		expect(modelPatternError('*-mini')).toContain('only allowed at the end');
		expect(modelPatternError('gpt-*-mini')).toContain('only allowed at the end');
		expect(modelPatternError('gpt**')).toContain('only allowed at the end');
	});

	it('rejects whitespace inside a pattern', () => {
		expect(modelPatternError('gpt 4o')).toContain('spaces');
	});

	it('reports the first bad pattern in a list', () => {
		expect(modelPatternsError(['gpt-4o', 'a*b', '*c'])).toContain('a*b');
		expect(modelPatternsError(['gpt-4o*'])).toBeNull();
	});
});

describe('patternMatchesKnown', () => {
	it('matches exact ids case-insensitively', () => {
		expect(patternMatchesKnown('GPT-4o', KNOWN)).toBe(true);
		expect(patternMatchesKnown('gpt-4', KNOWN)).toBe(false);
	});

	it('matches globs by prefix', () => {
		expect(patternMatchesKnown('gpt-4*', KNOWN)).toBe(true);
		expect(patternMatchesKnown('claude-opus*', KNOWN)).toBe(false);
		expect(patternMatchesKnown('*', KNOWN)).toBe(true);
	});

	it('treats dated snapshots of a known id as known', () => {
		expect(patternMatchesKnown('gpt-5.4-mini-2026-01-01', KNOWN)).toBe(true);
		expect(patternMatchesKnown('gpt-5.4-mini-2026*', KNOWN)).toBe(true);
		expect(patternMatchesKnown('gpt-5.4-minix', KNOWN)).toBe(false);
	});

	it('lists the unknown patterns, and none without a known list', () => {
		expect(unknownModelPatterns(['gpt-4o', 'gtp-4o', 'claude*'], KNOWN)).toEqual(['gtp-4o']);
		expect(unknownModelPatterns(['anything'], [])).toEqual([]);
	});
});

describe('model pattern chips', () => {
	it('splits comma-separated input without blanks', () => {
		expect(splitModelPatterns(' gpt-4o, ,claude* ,')).toEqual(['gpt-4o', 'claude*']);
	});

	it('appends new patterns and skips case-insensitive duplicates', () => {
		expect(addModelPatterns(['gpt-4o'], 'GPT-4o, claude*, claude*')).toEqual(['gpt-4o', 'claude*']);
		expect(addModelPatterns([], 'a, b')).toEqual(['a', 'b']);
	});
});
