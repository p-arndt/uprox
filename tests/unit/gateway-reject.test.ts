import { describe, expect, it, vi } from 'vitest';
import { reject, type RequestContext } from '$lib/server/gateway/context';

function ctx(auditFn: RequestContext['audit']): RequestContext {
	return {
		event: {} as RequestContext['event'],
		token: { serviceId: 'svc', tokenId: 'tok' } as RequestContext['token'],
		ip: '127.0.0.1',
		started: Date.now(),
		scope: 'chat',
		model: 'gpt-6-sol',
		envelope: {} as RequestContext['envelope'],
		audit: auditFn
	};
}

describe('reject', () => {
	it('audits a policy denial as gateway traffic with a deny status', async () => {
		// usage, budget and audit queries count gateway rows by the gateway.* prefix;
		// a denial outside it would never show up in the denied counts
		const audit = vi.fn(async () => null);
		await reject(ctx(audit), { statusCode: 403, detail: 'no', deny: true }, new Response());
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'gateway.chat', status: 'deny' })
		);
	});

	it('audits a gateway failure under the same action with an error status', async () => {
		const audit = vi.fn(async () => null);
		await reject(ctx(audit), { statusCode: 502, detail: 'upstream' }, new Response());
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'gateway.chat', status: 'error' })
		);
	});
});
