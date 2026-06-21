import { describe, it, expect, vi, beforeEach } from 'vitest';

// deleteToken hard-deletes a machine_token row and appends a `token.delete`
// audit record. We stub the db layer (so no real DELETE runs) and the audit
// layer (so we can assert exactly what gets recorded). The drizzle delete is a
// thenable builder — `db.delete(t).where(...).returning()` — modelled here as a
// chainable object whose `returning()` resolves to the rows we control.
let deletedRows: Array<Record<string, unknown>> = [];
const auditCalls: Array<Record<string, unknown>> = [];

vi.mock('$lib/server/db', () => {
	const builder = {
		where: () => builder,
		returning: () => Promise.resolve(deletedRows)
	};
	return { db: { delete: () => builder } };
});

vi.mock('$lib/server/audit', () => ({
	audit: (entry: Record<string, unknown>) => {
		auditCalls.push(entry);
		return Promise.resolve('audit-row-id');
	}
}));

import { deleteToken } from '$lib/server/data';

beforeEach(() => {
	deletedRows = [];
	auditCalls.length = 0;
});

describe('deleteToken', () => {
	it('removes the row and returns it', async () => {
		const row = { id: 'tok-1', serviceId: 'svc-1', name: 'ci-token' };
		deletedRows = [row];

		const result = await deleteToken('tok-1');

		expect(result).toEqual(row);
	});

	it('writes a token.delete audit record with no tokenId (the row is already gone)', async () => {
		deletedRows = [{ id: 'tok-1', serviceId: 'svc-1', name: 'ci-token' }];

		await deleteToken('tok-1');

		expect(auditCalls).toHaveLength(1);
		const entry = auditCalls[0];
		expect(entry.action).toBe('token.delete');
		expect(entry.status).toBe('ok');
		// serviceId + name survive in the audit row; the FK link does not, since the
		// token no longer exists (audit_log.token_id is ON DELETE SET NULL).
		expect(entry.serviceId).toBe('svc-1');
		expect(entry.detail).toBe('ci-token');
		expect(entry.tokenId).toBeUndefined();
	});

	it('returns null and records nothing when no token matched', async () => {
		deletedRows = [];

		const result = await deleteToken('missing');

		expect(result).toBeNull();
		expect(auditCalls).toHaveLength(0);
	});
});
