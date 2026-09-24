import { describe, expect, it } from 'vitest';
import { viewOnlyNav } from '$lib/nav-access';

describe('viewOnlyNav', () => {
	it('marks members and settings as view only for plain members', () => {
		expect(viewOnlyNav('/app/members', 'member')).toBe(true);
		expect(viewOnlyNav('/app/settings', 'member')).toBe(true);
	});

	it('leaves them editable for admins and owners', () => {
		for (const role of ['admin', 'owner']) {
			expect(viewOnlyNav('/app/members', role)).toBe(false);
			expect(viewOnlyNav('/app/settings', role)).toBe(false);
		}
	});

	it('never marks pages without a mapped capability', () => {
		expect(viewOnlyNav('/app/audit', 'member')).toBe(false);
		expect(viewOnlyNav('/app/tokens', 'member')).toBe(false);
	});
});
