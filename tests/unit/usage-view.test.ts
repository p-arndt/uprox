import { describe, expect, it } from 'vitest';
import { buildUsageExportHref, usageRangeLabel } from '$lib/features/usage/view.svelte';
import { buildUsageHref } from '$lib/features/usage/url';
import { normalizeMetric } from '$lib/features/usage/metric';
import { formatDayRange } from '$lib/features/usage/date-range';

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
		).toBe(formatDayRange('2026-01-01', '2026-01-31'));
	});
});

describe('buildUsageHref metric', () => {
	const state = { range: '7d', bucket: 'auto', customFrom: null, customTo: null };

	it('omits the default metric', () => {
		expect(buildUsageHref('/u', { ...state, metric: 'cost' })).toBe('/u?range=7d');
	});

	it('keeps a non-default metric across other changes', () => {
		expect(buildUsageHref('/u', { ...state, metric: 'tokens' }, { range: '30d' })).toBe(
			'/u?range=30d&metric=tokens'
		);
	});

	it('lets an override replace the metric', () => {
		expect(buildUsageHref('/u', { ...state, metric: 'tokens' }, { metric: 'requests' })).toBe(
			'/u?range=7d&metric=requests'
		);
	});
});

describe('normalizeMetric', () => {
	it('accepts known metrics and defaults the rest', () => {
		expect(normalizeMetric('requests')).toBe('requests');
		expect(normalizeMetric('tokens')).toBe('tokens');
		expect(normalizeMetric('bogus')).toBe('cost');
		expect(normalizeMetric(null)).toBe('cost');
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
