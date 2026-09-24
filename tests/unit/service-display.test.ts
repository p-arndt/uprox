import { describe, expect, it } from 'vitest';
import { deleteServiceDescription } from '../../src/routes/app/services/service-display';

describe('deleteServiceDescription', () => {
	it('states how many active tokens get revoked', () => {
		expect(deleteServiceDescription(0)).toMatch(/^This service has no active tokens\./);
		expect(deleteServiceDescription(1)).toMatch(/^1 active token will be revoked/);
		expect(deleteServiceDescription(3)).toMatch(/^3 active tokens will be revoked/);
	});
});
