import { describe, expect, it } from 'vitest';
import {
	isEscalation,
	memberGrants,
	roleLabel,
	roleVariant
} from '../../src/routes/app/members/member-roles';

describe('member roles', () => {
	it('labels assignable roles and passes others through', () => {
		expect(roleLabel('admin')).toBe('Admin');
		expect(roleLabel('member')).toBe('Member');
		expect(roleLabel('owner')).toBe('owner');
	});

	it('maps roles to badge variants', () => {
		expect(roleVariant('owner')).toBe('default');
		expect(roleVariant('admin')).toBe('secondary');
		expect(roleVariant('member')).toBe('outline');
		expect(roleVariant('something')).toBe('outline');
	});

	it('flags only changes that grant more power', () => {
		expect(isEscalation('member', 'admin')).toBe(true);
		expect(isEscalation('admin', 'owner')).toBe(true);
		expect(isEscalation('admin', 'member')).toBe(false);
		expect(isEscalation('member', 'member')).toBe(false);
	});

	it('lists what member-permission toggles grant', () => {
		expect(
			memberGrants({ membersCanManageTokens: false, membersCanManageServices: false })
		).toEqual([]);
		expect(memberGrants({ membersCanManageTokens: true, membersCanManageServices: true })).toEqual([
			'machine tokens',
			'services'
		]);
	});
});
