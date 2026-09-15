import { describe, expect, it } from 'vitest';
import { buildUsageExportHref, usageRangeLabel } from '$lib/features/usage/view.svelte';

const ranges = [
	{ key: '7d', label: 'Last 7 days' },
	{ key: '30d', label: 'Last 30 days' }
] as const;

const base = {
	range: '7d',
	bucket: 'auto',
	customFrom: null,
	customTo: null,
	groupBy: 'service' as const,
	filters: [],
	ranges
};

describe('usageRangeLabel', () => {
	it('uses the preset label', () => {
		expect(usageRangeLabel(base)).toBe('Last 7 days');
	});

	it('falls back to the raw key for an unknown preset', () => {
		expect(usageRangeLabel({ ...base, range: '1y' })).toBe('1y');
	});

	it('shows the custom bounds', () => {
		expect(
			usageRangeLabel({
				...base,
				range: 'custom',
				customFrom: '2026-01-01',
				customTo: '2026-01-31'
			})
		).toBe('2026-01-01 – 2026-01-31');
	});
});

describe('buildUsageExportHref', () => {
	it('targets the export path with the page query plus shape', () => {
		expect(
			buildUsageExportHref(
				'/app/usage/export',
				{ range: '30d', bucket: 'day', customFrom: null, customTo: null },
				'timeseries'
			)
		).toBe('/app/usage/export?range=30d&bucket=day&shape=timeseries');
	});

	it('keeps custom bounds', () => {
		expect(
			buildUsageExportHref(
				'/x',
				{ range: 'custom', bucket: 'auto', customFrom: '2026-01-01', customTo: '2026-01-02' },
				'breakdown'
			)
		).toBe('/x?range=custom&from=2026-01-01&to=2026-01-02&shape=breakdown');
	});
});
