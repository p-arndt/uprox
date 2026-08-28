import { describe, it, expect } from 'vitest';
import { parseUsageWindow } from '../../src/lib/server/usage-window-pref';

describe('parseUsageWindow', () => {
	it('restores a preset window', () => {
		expect(parseUsageWindow(JSON.stringify({ range: 'this-month', bucket: 'day' }))).toEqual({
			range: 'this-month',
			from: null,
			to: null,
			bucket: 'day'
		});
	});

	it('restores a custom window with its bounds', () => {
		expect(
			parseUsageWindow(
				JSON.stringify({ range: 'custom', from: '2026-01-01', to: '2026-01-31', bucket: 'auto' })
			)
		).toEqual({ range: 'custom', from: '2026-01-01', to: '2026-01-31', bucket: 'auto' });
	});

	it('drops a custom window that lost a bound', () => {
		expect(parseUsageWindow(JSON.stringify({ range: 'custom', from: '2026-01-01' }))).toBeNull();
	});

	it('rejects junk rather than silently defaulting', () => {
		// the cookie is client-writable, so an unknown key must not be coerced into
		// a "remembered" default that then overrides the page's own default
		expect(parseUsageWindow(JSON.stringify({ range: 'last-decade' }))).toBeNull();
		expect(parseUsageWindow('not json')).toBeNull();
		expect(parseUsageWindow(undefined)).toBeNull();
	});

	it('falls back to auto for an unknown bucket', () => {
		expect(parseUsageWindow(JSON.stringify({ range: '7d', bucket: 'fortnight' }))?.bucket).toBe(
			'auto'
		);
	});
});
