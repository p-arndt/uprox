import { describe, it, expect, vi } from 'vitest';
import { openAiEnvelope, geminiEnvelope, makeAuditTrace } from '$lib/server/gateway';
import type { AuditEntry } from '$lib/server/audit';

describe('error envelopes', () => {
	it('builds the OpenAI error shape with the mapped error type', async () => {
		const res = openAiEnvelope.error(403, 'Request denied by policy: nope', 'permission');
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			error: {
				message: 'Request denied by policy: nope',
				type: 'permission_error',
				code: null,
				param: null
			}
		});
	});

	it('builds the native Gemini error shape with the mapped Google status', async () => {
		const res = geminiEnvelope.error(502, 'No endpoint', 'upstream_misconfigured');
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: { code: 502, message: 'No endpoint', status: 'FAILED_PRECONDITION' }
		});
	});

	it('sets retry-after on rate-limited responses in both envelopes', async () => {
		const openai = openAiEnvelope.rateLimited(10, 7);
		expect(openai.status).toBe(429);
		expect(openai.headers.get('retry-after')).toBe('7');
		expect(openai.headers.get('content-type')).toContain('application/json');
		expect((await openai.json()).error.type).toBe('rate_limit_error');

		const gemini = geminiEnvelope.rateLimited(10, undefined);
		expect(gemini.status).toBe(429);
		expect(gemini.headers.get('retry-after')).toBe('1');
		expect(await gemini.json()).toEqual({
			error: {
				code: 429,
				message: 'Rate limit exceeded: 10 requests/min',
				status: 'RESOURCE_EXHAUSTED'
			}
		});
	});
});

describe('makeAuditTrace', () => {
	const entry: AuditEntry = { action: 'gateway.chat', status: 'ok' };
	const base = {
		serviceId: 'svc-1',
		groupId: 'group-1',
		metadata: { chat: 'c1' },
		request: { model: 'gpt-4o' }
	};

	it('always audits, and records a trace with the response when tracing is on', async () => {
		const audit = vi.fn(async () => 'audit-1');
		const recordTrace = vi.fn(async () => {});
		const trace = makeAuditTrace({ ...base, tracingEnabled: true }, { audit, recordTrace });

		await trace(entry, { response: '{"ok":true}', format: 'json' });

		expect(audit).toHaveBeenCalledWith(entry);
		expect(recordTrace).toHaveBeenCalledWith({
			auditLogId: 'audit-1',
			serviceId: 'svc-1',
			groupId: 'group-1',
			metadata: { chat: 'c1' },
			request: { model: 'gpt-4o' },
			response: '{"ok":true}',
			format: 'json'
		});
	});

	it('records a request-only trace when no response is passed', async () => {
		const recordTrace = vi.fn(async () => {});
		const trace = makeAuditTrace(
			{ ...base, tracingEnabled: true },
			{ audit: async () => 'audit-2', recordTrace }
		);

		await trace(entry);

		expect(recordTrace).toHaveBeenCalledWith(
			expect.objectContaining({ auditLogId: 'audit-2', response: null, format: null })
		);
	});

	it('skips the trace when tracing is off or the audit insert failed', async () => {
		const recordTrace = vi.fn(async () => {});
		await makeAuditTrace(
			{ ...base, tracingEnabled: false },
			{ audit: async () => 'audit-3', recordTrace }
		)(entry);
		await makeAuditTrace(
			{ ...base, tracingEnabled: true },
			{ audit: async () => null, recordTrace }
		)(entry);

		expect(recordTrace).not.toHaveBeenCalled();
	});
});
