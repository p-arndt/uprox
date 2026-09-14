import { describe, it, expect } from 'vitest';
import {
	areaPath,
	axisLabel,
	axisScale,
	bucketCenterPct,
	bucketLabel,
	bucketTotals,
	hoverRows,
	niceStep,
	segmentHeights,
	tickEvery,
	topSegmentIndex,
	valueMatrix
} from '$lib/features/usage/chart-math';

const pt = (costUsd: number, requests = 0, tokens = 0) => ({ costUsd, requests, tokens });

describe('niceStep', () => {
	it('rounds up to 1, 2, 2.5, 5 or 10 times a power of ten', () => {
		expect(niceStep(0.9)).toBeCloseTo(1);
		expect(niceStep(1.5)).toBe(2);
		expect(niceStep(2.2)).toBe(2.5);
		expect(niceStep(3)).toBe(5);
		expect(niceStep(6.459)).toBe(10);
		expect(niceStep(160)).toBe(200);
		expect(niceStep(0.0031)).toBeCloseTo(0.005);
	});

	it('falls back to 1 for non-positive input', () => {
		expect(niceStep(0)).toBe(1);
		expect(niceStep(-3)).toBe(1);
	});
});

describe('bucketLabel', () => {
	const iso = '2026-03-07T09:00:00.000Z';
	it('formats per unit in UTC', () => {
		expect(bucketLabel(iso, 'hour')).toBe('Mar 7 09:00');
		expect(bucketLabel(iso, 'day')).toBe('Mar 7');
		expect(bucketLabel(iso, 'week')).toBe('wk Mar 7');
		expect(bucketLabel(iso, 'month')).toBe('Mar 2026');
	});
});

describe('valueMatrix', () => {
	const series = [{ points: [pt(1, 10, 100), pt(2, 20, 200)] }, { points: [pt(3, 30, 300)] }];

	it('reads the selected metric and fills missing points with zero', () => {
		expect(valueMatrix(series, 2, 'cost', 'absolute')).toEqual([
			[1, 2],
			[3, 0]
		]);
		expect(valueMatrix(series, 2, 'requests', 'normalized')).toEqual([
			[10, 20],
			[30, 0]
		]);
		expect(valueMatrix(series, 2, 'tokens', 'absolute')[0]).toEqual([100, 200]);
	});

	it('accumulates across buckets in cumulative mode', () => {
		expect(valueMatrix(series, 2, 'cost', 'cumulative')).toEqual([
			[1, 3],
			[3, 3]
		]);
	});
});

describe('bucketTotals', () => {
	it('sums each column', () => {
		expect(
			bucketTotals(
				[
					[1, 2],
					[3, 4]
				],
				2
			)
		).toEqual([4, 6]);
		expect(bucketTotals([], 3)).toEqual([0, 0, 0]);
	});
});

describe('axisScale', () => {
	it('rounds the peak up to a whole number of nice steps', () => {
		const s = axisScale([3, 7.9], 'absolute');
		expect(s.step).toBe(2);
		expect(s.peak).toBe(8);
		expect(s.ticks).toEqual([8, 6, 4, 2, 0]);
	});

	it('uses a fixed 0-100 axis when normalized', () => {
		const s = axisScale([3, 7.9], 'normalized');
		expect(s.peak).toBe(100);
		expect(s.ticks).toEqual([100, 75, 50, 25, 0]);
	});

	it('still produces a usable axis when everything is zero', () => {
		expect(axisScale([0, 0], 'absolute').peak).toBe(1);
	});
});

describe('segmentHeights / topSegmentIndex', () => {
	const values = [
		[2, 0],
		[2, 4]
	];
	const totals = [4, 4];

	it('scales against the axis peak', () => {
		expect(segmentHeights(values, totals, 8, 'absolute')).toEqual([
			[25, 0],
			[25, 50]
		]);
	});

	it('scales against each bucket total when normalized', () => {
		expect(segmentHeights(values, totals, 100, 'normalized')).toEqual([
			[50, 0],
			[50, 100]
		]);
	});

	it('finds the topmost non-empty segment', () => {
		const h = [
			[10, 5],
			[0, 0]
		];
		expect(topSegmentIndex(h, 0)).toBe(0);
		expect(topSegmentIndex([[0], [0]], 0)).toBe(-1);
	});
});

describe('areaPath', () => {
	const heights = [
		[50, 25],
		[10, 25]
	];

	it('draws the bottom band from the baseline', () => {
		expect(areaPath(heights, 0, 2)).toBe('M25.00,50.00 L75.00,75.00 L75.00,100.00 L25.00,100.00 Z');
	});

	it('stacks upper bands on the previous edge', () => {
		expect(areaPath(heights, 1, 2)).toBe('M25.00,40.00 L75.00,50.00 L75.00,75.00 L25.00,50.00 Z');
	});

	it('is empty without buckets', () => {
		expect(areaPath([], 0, 0)).toBe('');
	});
});

describe('layout helpers', () => {
	it('labels roughly one bucket in eight', () => {
		expect(tickEvery(0)).toBe(1);
		expect(tickEvery(8)).toBe(1);
		expect(tickEvery(90)).toBe(12);
	});

	it('centres a bucket in its band', () => {
		expect(bucketCenterPct(0, 4)).toBe(12.5);
		expect(bucketCenterPct(3, 4)).toBe(87.5);
	});
});

describe('axisLabel', () => {
	it('prints percentages when normalized', () => {
		expect(axisLabel(75, 'cost', 'normalized')).toBe('75%');
	});

	it('uses the en-US compact formatters regardless of metric', () => {
		expect(axisLabel(0, 'cost', 'absolute')).toBe('$0.00');
		expect(axisLabel(25_000, 'cost', 'absolute')).toBe('$25K');
		expect(axisLabel(2_500, 'requests', 'absolute')).toBe('2,500');
		expect(axisLabel(25_000, 'requests', 'cumulative')).toBe('25K');
		expect(axisLabel(1_500_000, 'tokens', 'absolute')).toBe('1.5M');
	});
});

describe('hoverRows', () => {
	it('keeps contributing series, largest first, with their bucket share', () => {
		const rows = hoverRows(
			[
				{ key: 'a', label: 'A' },
				{ key: 'b', label: 'B' },
				{ key: 'c', label: 'C' }
			],
			['red', 'green', 'blue'],
			[[1], [3], [0]],
			[4],
			0
		);
		expect(rows).toEqual([
			{ key: 'b', label: 'B', color: 'green', value: 3, share: 0.75 },
			{ key: 'a', label: 'A', color: 'red', value: 1, share: 0.25 }
		]);
	});
});
