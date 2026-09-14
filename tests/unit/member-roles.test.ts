import { describe, expect, it } from 'vitest';
import { roleLabel, roleVariant } from '../../src/routes/app/members/member-roles';

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
});
