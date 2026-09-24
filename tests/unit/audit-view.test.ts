import { describe, expect, it } from 'vitest';
import { actionLabel, auditFilterParams, parseAuditFilter } from '$lib/audit-view';

const params = (query: string) => new URLSearchParams(query);

describe('parseAuditFilter', () => {
	it('reads every known filter', () => {
		const cursor = '0b6c1f0e-2f7a-4d8e-9a51-3c2b1d0e9f87';
		expect(
			parseAuditFilter(params(`q=+gpt-4o+&status=denied&kind=gateway&range=24h&cursor=${cursor}`))
		).toEqual({ q: 'gpt-4o', status: 'denied', kind: 'gateway', range: '24h', cursor });
	});

	it('drops unknown values instead of failing', () => {
		expect(
			parseAuditFilter(params('q=%20&status=weird&kind=x&range=1y&cursor=not-a-uuid'))
		).toEqual({
			q: undefined,
			status: undefined,
			kind: undefined,
			range: undefined,
			cursor: undefined
		});
	});

	it('round-trips through search params, leaving defaults out', () => {
		const filter = { q: 'deny', status: 'error' as const, range: '7d' as const };
		const encoded = auditFilterParams(filter);
		expect(encoded.toString()).toBe('q=deny&status=error&range=7d');
		expect(parseAuditFilter(encoded)).toMatchObject(filter);
		expect(auditFilterParams({}).toString()).toBe('');
	});
});

describe('actionLabel', () => {
	it('names gateway requests by scope', () => {
		expect(actionLabel('gateway.chat')).toBe('Chat request');
		expect(actionLabel('gateway.embeddings')).toBe('Embeddings request');
	});

	it('names admin actions as noun + past tense', () => {
		expect(actionLabel('token.revoke')).toBe('Token revoked');
		expect(actionLabel('pricing.upsert')).toBe('Model price saved');
		expect(actionLabel('policy.delete')).toBe('Preset deleted');
		expect(actionLabel('policy.deny')).toBe('Denied by preset');
	});

	it('falls back to the raw id for anything unknown', () => {
		expect(actionLabel('gateway.teleport')).toBe('gateway.teleport');
		expect(actionLabel('widget.create')).toBe('widget.create');
		expect(actionLabel('token')).toBe('token');
	});
});
