import { describe, expect, it } from 'vitest';
import { invitationProblem, normalizeRole } from '$lib/server/members';

describe('normalizeRole', () => {
	it('only grants admin when asked explicitly', () => {
		expect(normalizeRole('admin')).toBe('admin');
		expect(normalizeRole('member')).toBe('member');
		expect(normalizeRole('owner')).toBe('member');
		expect(normalizeRole(undefined)).toBe('member');
	});
});

describe('invitationProblem', () => {
	const now = Date.UTC(2026, 0, 10);
	const future = new Date(now + 1_000);
	const past = new Date(now - 1_000);

	it('accepts a pending, unexpired invitation', () => {
		expect(invitationProblem({ status: 'pending', expiresAt: future }, now)).toBeNull();
	});

	it('reports a missing invitation', () => {
		expect(invitationProblem(null, now)).toBe('missing');
	});

	it('reports accepted, canceled and other inactive states', () => {
		expect(invitationProblem({ status: 'accepted', expiresAt: future }, now)).toBe('accepted');
		expect(invitationProblem({ status: 'canceled', expiresAt: future }, now)).toBe('canceled');
		expect(invitationProblem({ status: 'rejected', expiresAt: future }, now)).toBe('inactive');
	});

	it('reports expiry', () => {
		expect(invitationProblem({ status: 'pending', expiresAt: past }, now)).toBe('expired');
	});
});
