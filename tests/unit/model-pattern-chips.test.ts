import { describe, expect, it } from 'vitest';
import {
	addModelPatterns,
	matchSuggestions
} from '../../src/lib/features/policies/model-pattern-chips';

const known = ['claude-sonnet-5', 'claude-opus-5', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-4o'];

describe('matchSuggestions', () => {
	it('lists ids starting with the draft before ids that merely contain it', () => {
		expect(matchSuggestions(['x-gpt', 'gpt-4o', 'gpt-5.5'], [], 'gpt')).toEqual([
			'gpt-4o',
			'gpt-5.5',
			'x-gpt'
		]);
	});

	it('matches anywhere in the id, case-insensitively', () => {
		expect(matchSuggestions(known, [], 'SONNET')).toEqual(['claude-sonnet-5']);
	});

	it('leaves out ids already chosen', () => {
		expect(matchSuggestions(known, ['GPT-5.5'], 'gpt-5')).toEqual(['gpt-5.5-pro']);
	});

	it('offers the first ids when nothing is typed, capped at the limit', () => {
		expect(matchSuggestions(known, [], '', 2)).toEqual(['claude-sonnet-5', 'claude-opus-5']);
	});
});

describe('addModelPatterns', () => {
	it('splits a pasted list and skips case-insensitive duplicates', () => {
		expect(addModelPatterns(['gpt-4o'], 'GPT-4o, claude-*')).toEqual(['gpt-4o', 'claude-*']);
	});
});
