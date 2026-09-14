import { describe, expect, it } from 'vitest';
import { safeRedirect } from '$lib/server/auth-config';

describe('safeRedirect', () => {
	it('keeps internal single-slash paths', () => {
		expect(safeRedirect('/app/usage?range=7d')).toBe('/app/usage?range=7d');
	});

	it('falls back to /app for missing, external or protocol-relative targets', () => {
		expect(safeRedirect(null)).toBe('/app');
		expect(safeRedirect(undefined)).toBe('/app');
		expect(safeRedirect('')).toBe('/app');
		expect(safeRedirect('https://evil.example')).toBe('/app');
		expect(safeRedirect('//evil.example')).toBe('/app');
	});
});
