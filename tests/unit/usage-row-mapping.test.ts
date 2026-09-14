import { describe, expect, it } from 'vitest';
import {
	foldGroupedRows,
	mapOrgStats,
	mapTotalsRow,
	num
} from '$lib/server/usage-queries/row-mapping';

describe('num', () => {
	it('turns driver aggregates into numbers, NULL into zero', () => {
		expect(num(3)).toBe(3);
		expect(num('12.500000')).toBe(12.5);
		expect(num('9007199254')).toBe(9_007_199_254);
		expect(num(null)).toBe(0);
		expect(num(undefined)).toBe(0);
	});
});

describe('mapTotalsRow', () => {
	it('zeroes an empty window and leaves latency unmeasured', () => {
		expect(mapTotalsRow(undefined, [])).toEqual({
			requests: 0,
			costUsd: 0,
			errors: 0,
			denied: 0,
			latencyP50: null,
			latencyP95: null,
			inputTokens: 0,
			outputTokens: 0,
			savedInputTokens: 0,
			providerCachedTokens: 0,
			embeddingInputTokens: 0,
			embeddingOutputTokens: 0
		});
	});

	it('maps the aggregate row and derives percentiles from the histogram', () => {
		const totals = mapTotalsRow(
			{
				requests: 4,
				cost: '1.250000',
				errors: 1,
				denied: 0,
				inputTokens: '1000',
				outputTokens: '200',
				savedInputTokens: '50',
				providerCachedTokens: '300',
				embeddingInputTokens: '10',
				embeddingOutputTokens: '0'
			},
			[
				{ latencyMs: 100, count: 1 },
				{ latencyMs: 300, count: 1 }
			]
		);
		expect(totals).toMatchObject({
			requests: 4,
			costUsd: 1.25,
			errors: 1,
			inputTokens: 1000,
			outputTokens: 200,
			providerCachedTokens: 300,
			latencyP50: 200,
			latencyP95: 290
		});
	});
});

describe('mapOrgStats', () => {
	it('handles an instance without traffic', () => {
		const stats = mapOrgStats({ services: 2, providers: '1', activeTokens: null }, undefined);
		expect(stats).toMatchObject({
			services: 2,
			providers: 1,
			activeTokens: 0,
			requests: 0,
			cacheHitRate: 0,
			tokenCacheRate: 0,
			costUsd: 0
		});
	});

	it('computes request and token cache rates', () => {
		const stats = mapOrgStats(
			{ services: 1, providers: 1, activeTokens: 3 },
			{
				total: '10',
				cost: '2.5',
				denied: '1',
				cacheHits: '2',
				cacheSaved: '0.4',
				inputTokens: '1000',
				outputTokens: '100',
				savedInputTokens: '100',
				savedOutputTokens: '10',
				providerCachedTokens: '100',
				embeddingInputTokens: '0'
			}
		);
		expect(stats).toMatchObject({
			requests: 10,
			denied: 1,
			costUsd: 2.5,
			cacheHits: 2,
			cacheHitRate: 0.2,
			cacheSavedUsd: 0.4,
			inputTokens: 1000,
			outputTokens: 100,
			savedOutputTokens: 10
		});
		expect(stats.tokenCacheRate).toBeGreaterThan(0);
		expect(stats.tokenCacheRate).toBeLessThanOrEqual(1);
	});
});

describe('foldGroupedRows', () => {
	const axis = [
		{ key: 'a', label: 'A', hint: null },
		{ key: 'b', label: 'B', hint: 'hint' }
	];

	it('builds dense per-series arrays in bucket order and sums the window totals', () => {
		const rows = [
			{ bucket: 't1', key: 'a', requests: 1, denied: 0, cost: '0.5', tokens: '10' },
			{ bucket: 't1', key: 'b', requests: 0, denied: 0, cost: '0', tokens: '0' },
			{ bucket: 't2', key: 'a', requests: 2, denied: 1, cost: '1.5', tokens: '30' },
			{ bucket: 't2', key: 'b', requests: 3, denied: 0, cost: '2', tokens: '40' }
		];
		const { buckets, series } = foldGroupedRows(rows, axis);
		expect(buckets).toEqual(['t1', 't2']);
		expect(series.map((s) => s.key)).toEqual(['a', 'b']);
		expect(series[0]).toMatchObject({ costUsd: 2, requests: 3, tokens: 40, label: 'A' });
		expect(series[1].points).toEqual([
			{ requests: 0, denied: 0, costUsd: 0, tokens: 0 },
			{ requests: 3, denied: 0, costUsd: 2, tokens: 40 }
		]);
		expect(series[1].hint).toBe('hint');
	});

	it('keeps axis series without cells as zeros and ignores unknown keys', () => {
		const rows = [{ bucket: 't1', key: 'zzz', requests: 5, denied: 0, cost: '9', tokens: '9' }];
		const { buckets, series } = foldGroupedRows(rows, axis);
		expect(buckets).toEqual(['t1']);
		expect(series.every((s) => s.costUsd === 0 && s.points.length === 1)).toBe(true);
	});

	it('returns empty buckets for no rows', () => {
		expect(foldGroupedRows([], axis)).toEqual({
			buckets: [],
			series: axis.map((a) => ({ ...a, points: [], costUsd: 0, requests: 0, tokens: 0 }))
		});
	});
});
