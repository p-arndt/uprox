import { describe, expect, it } from 'vitest';
import {
	actionError,
	deleteServiceDescription,
	partitionTokens,
	serviceTypeLabel
} from '../../src/routes/app/services/service-display';

describe('deleteServiceDescription', () => {
	it('states how many active tokens get revoked', () => {
		expect(deleteServiceDescription(0)).toMatch(/^This service has no active tokens\./);
		expect(deleteServiceDescription(1)).toMatch(/^1 active token will be revoked/);
		expect(deleteServiceDescription(3)).toMatch(/^3 active tokens will be revoked/);
	});

	it('warns that a deleted Default service comes back empty', () => {
		expect(deleteServiceDescription(2, 'Default')).toMatch(/freshly created, empty Default/);
		expect(deleteServiceDescription(2, 'Default')).toMatch(/can't be undone\.$/);
		expect(deleteServiceDescription(2, 'billing')).not.toMatch(/Default/);
		expect(deleteServiceDescription(2, 'default')).not.toMatch(/Default/);
	});
});

describe('serviceTypeLabel', () => {
	it('uses the form labels and passes unknown types through', () => {
		expect(serviceTypeLabel('app')).toBe('App');
		expect(serviceTypeLabel('agent')).toBe('Agent');
		expect(serviceTypeLabel('workload')).toBe('Workload');
		expect(serviceTypeLabel('batch')).toBe('batch');
	});
});

describe('actionError', () => {
	const failed = { action: 'create', message: 'A service with this name already exists' };

	it('returns the message only for the matching failed action', () => {
		expect(actionError(failed, 'create')).toBe(failed.message);
		expect(actionError(failed, 'update')).toBeUndefined();
		expect(actionError({ action: 'create', success: true }, 'create')).toBeUndefined();
		expect(actionError(null, 'create')).toBeUndefined();
	});

	it('hides a result the user already dismissed', () => {
		expect(actionError(failed, 'create', failed)).toBeUndefined();
		expect(actionError({ ...failed }, 'create', failed)).toBe(failed.message);
	});
});

describe('partitionTokens', () => {
	const past = new Date(Date.now() - 60_000);
	const future = new Date(Date.now() + 60_000);

	it('splits active from revoked and expired, keeping order', () => {
		const tokens = [
			{ id: 'revoked', revokedAt: past, expiresAt: null },
			{ id: 'a1', revokedAt: null, expiresAt: null },
			{ id: 'expired', revokedAt: null, expiresAt: past },
			{ id: 'a2', revokedAt: null, expiresAt: future }
		];
		const { active, inactive } = partitionTokens(tokens);
		expect(active.map((t) => t.id)).toEqual(['a1', 'a2']);
		expect(inactive.map((t) => t.id)).toEqual(['revoked', 'expired']);
	});
});
