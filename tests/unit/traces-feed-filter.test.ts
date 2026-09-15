import { describe, expect, it } from 'vitest';
import {
	feedHaystack,
	feedKey,
	feedTone,
	filterFeed,
	type FeedEntry
} from '../../src/routes/app/traces/feed-filter';
import { callLabel, sessionTotals } from '../../src/routes/app/traces/session/[groupId]/session';

const session = (over: Partial<Extract<FeedEntry, { kind: 'session' }>> = {}): FeedEntry => ({
	kind: 'session',
	groupId: 'grp-1',
	serviceName: 'billing',
	models: ['gpt-4o'],
	errorCount: 0,
	...over
});

const call = (over: Partial<Extract<FeedEntry, { kind: 'call' }>> = {}): FeedEntry => ({
	kind: 'call',
	id: 'call-1',
	action: 'gateway.chat',
	status: 'ok',
	model: 'claude-sonnet',
	serviceName: 'support',
	provider: 'anthropic',
	detail: null,
	metadata: { user_id: 'u_42' },
	...over
});

describe('traces feed filter', () => {
	it('derives tone and key per entry kind', () => {
		expect(feedTone(session())).toBe('ok');
		expect(feedTone(session({ errorCount: 2 }))).toBe('error');
		expect(feedTone(call({ status: 'deny' }))).toBe('denied');
		expect(feedKey(session())).toBe('g:grp-1');
		expect(feedKey(call())).toBe('c:call-1');
	});

	it('searches session fields and call metadata', () => {
		expect(feedHaystack(session())).toBe('session grp-1 billing gpt-4o');
		expect(feedHaystack(call())).toContain('"user_id":"u_42"');
	});

	it('filters by status tone and trimmed, case-insensitive query', () => {
		const items = [session(), session({ groupId: 'grp-2', errorCount: 1 }), call()];
		expect(filterFeed(items, '', 'all')).toHaveLength(3);
		expect(filterFeed(items, '', 'error').map(feedKey)).toEqual(['g:grp-2']);
		expect(filterFeed(items, '', 'denied')).toEqual([]);
		expect(filterFeed(items, '  ANTHROPIC ', 'ok').map(feedKey)).toEqual(['c:call-1']);
	});
});

describe('session helpers', () => {
	it('labels a call by model, else action without the gateway prefix', () => {
		expect(callLabel({ model: 'gpt-4o', action: 'gateway.chat' })).toBe('gpt-4o');
		expect(callLabel({ model: null, action: 'gateway.embeddings' })).toBe('embeddings');
		expect(callLabel({ model: null, action: null })).toBe('request');
	});

	it('sums cost and tokens and picks the first service name', () => {
		expect(
			sessionTotals([
				{ costUsd: '0.5', inputTokens: 10, outputTokens: 2, serviceName: null },
				{ costUsd: null, inputTokens: null, outputTokens: 3, serviceName: 'billing' }
			])
		).toEqual({ cost: 0.5, tokensIn: 10, tokensOut: 5, serviceName: 'billing' });
	});
});
