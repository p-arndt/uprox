import { describe, it, expect } from 'vitest';
import { can, DEFAULT_MEMBER_PERMISSIONS, type Capability } from '$lib/permissions';

const ALL_CAPS: Capability[] = [
	'providers:manage',
	'policies:manage',
	'services:manage',
	'tokens:manage',
	'settings:manage',
	'members:manage'
];

describe('can — owner & admin', () => {
	it('owner may do everything', () => {
		for (const cap of ALL_CAPS) expect(can('owner', cap)).toBe(true);
	});

	it('admin may do everything (admin ⊇ member)', () => {
		for (const cap of ALL_CAPS) expect(can('admin', cap)).toBe(true);
	});
});

describe('can — member (read-only by default)', () => {
	it('is denied every capability with default settings', () => {
		for (const cap of ALL_CAPS) expect(can('member', cap)).toBe(false);
	});

	it('can be opted into tokens:manage via org settings', () => {
		expect(can('member', 'tokens:manage', { ...DEFAULT_MEMBER_PERMISSIONS, membersCanManageTokens: true })).toBe(true);
		// the opt-in is scoped to that one capability, nothing else leaks
		expect(can('member', 'services:manage', { ...DEFAULT_MEMBER_PERMISSIONS, membersCanManageTokens: true })).toBe(false);
	});

	it('can be opted into services:manage via org settings', () => {
		expect(can('member', 'services:manage', { ...DEFAULT_MEMBER_PERMISSIONS, membersCanManageServices: true })).toBe(true);
	});

	it('never grants owner-only caps to members even with both toggles on', () => {
		const settings = { membersCanManageTokens: true, membersCanManageServices: true };
		expect(can('member', 'providers:manage', settings)).toBe(false);
		expect(can('member', 'policies:manage', settings)).toBe(false);
		expect(can('member', 'settings:manage', settings)).toBe(false);
		expect(can('member', 'members:manage', settings)).toBe(false);
	});
});

describe('can — unknown roles', () => {
	it('treats an unrecognized role as a member', () => {
		expect(can('guest', 'providers:manage')).toBe(false);
		expect(can('', 'tokens:manage', { ...DEFAULT_MEMBER_PERMISSIONS, membersCanManageTokens: true })).toBe(true);
	});
});
