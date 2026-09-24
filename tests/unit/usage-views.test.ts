import { describe, it, expect, assert } from 'vitest';
import { formatMetric, metricValue } from '$lib/features/usage/metric';
import { DONUT_TAIL_KEY, donutArcs, donutSlices } from '$lib/features/usage/donut';
import { formatLatencyMs, headlineCells, pctDelta } from '$lib/features/usage/headline';
import { cacheSavings, meterRows } from '$lib/features/usage/token-meters';
import { priceExtreme, priceExtremes } from '$lib/features/usage/efficiency';
import { OTHERS_COLOR } from '$lib/features/usage/colors';

describe('metric', () => {
	const p = { costUsd: 1.5, requests: 3, tokens: 12_000 };
	it('picks and formats the selected metric', () => {
		expect(metricValue(p, 'cost')).toBe(1.5);
		expect(metricValue(p, 'requests')).toBe(3);
		expect(metricValue(p, 'tokens')).toBe(12_000);
		expect(metricValue(undefined, 'cost')).toBe(0);
		expect(formatMetric(1.5, 'cost')).toBe('$1.50');
		expect(formatMetric(1234, 'requests')).toBe('1,234');
		expect(formatMetric(12_000, 'tokens')).toBe('12K');
	});
});

describe('donut', () => {
	const row = (key: string, costUsd: number, requests = 0) => ({
		key,
		label: key.toUpperCase(),
		costUsd,
		requests,
		inputTokens: 0,
		outputTokens: 0
	});

	it('ranks by the displayed metric and folds the tail into Others', () => {
		const rows = [row('a', 5, 1), row('b', 3, 9), row('c', 2, 0)];
		const { total, slices } = donutSlices(rows, 'service', 'requests', 1, null);
		expect(total).toBe(10);
		expect(slices.map((s) => [s.key, s.value])).toEqual([
			['b', 9],
			[DONUT_TAIL_KEY, 1]
		]);
		expect(slices[1]?.label).toBe('Others (2+)');
		expect(slices[1]?.color).toBe(OTHERS_COLOR);
	});

	it('reconciles against the scope total when given', () => {
		const { total, slices } = donutSlices([row('a', 4)], 'service', 'cost', 5, 10);
		expect(total).toBe(10);
		expect(slices.at(-1)).toMatchObject({ key: DONUT_TAIL_KEY, label: 'Others', value: 6 });
	});

	it('lays arcs end to end with a gap', () => {
		const arcs = donutArcs(
			[
				{ key: 'a', label: 'A', value: 3, color: 'x' },
				{ key: 'b', label: 'B', value: 1, color: 'y' }
			],
			4
		);
		expect(arcs.map((a) => [a.pct, a.offset])).toEqual([
			[75, 0],
			[25, 75]
		]);
		expect(arcs[0]?.dash).toBeCloseTo(74.4);
	});
});

describe('headline', () => {
	const totals = {
		requests: 100,
		costUsd: 20,
		errors: 5,
		denied: 2,
		latencyP50: 400,
		latencyP95: 1500,
		inputTokens: 800,
		outputTokens: 200,
		savedInputTokens: 0,
		providerCachedTokens: 200,
		embeddingInputTokens: 0
	};

	it('computes period-over-period deltas', () => {
		expect(pctDelta(15, 10)).toBe(50);
		expect(pctDelta(5, 0)).toBeNull();
	});

	it('formats latency', () => {
		expect(formatLatencyMs(null)).toBe('—');
		expect(formatLatencyMs(400)).toBe('400 ms');
		expect(formatLatencyMs(1500)).toBe('1.50 s');
	});

	it('builds the six cells', () => {
		const cells = headlineCells(totals, { ...totals, costUsd: 10 }, [
			{ requests: 1, costUsd: 2, inputTokens: 3, outputTokens: 4 }
		]);
		expect(cells.map((c) => c.label)).toEqual([
			'Spend',
			'Requests',
			'Tokens',
			'Errors & denials',
			'Cache rate',
			'Latency p95'
		]);
		expect(cells[0]).toMatchObject({ value: '$20.00', delta: 100, note: '$0.20 avg / request' });
		expect(cells[1]?.note).toBe('93 succeeded');
		expect(cells[2]?.spark).toEqual([7]);
		expect(cells[3]).toMatchObject({ value: '7.0%', note: '5 errors · 2 denied', alert: true });
		expect(cells[4]).toMatchObject({ value: '25.0%' });
		assert(cells[4]);
		expect(cells[4].delta).toBeUndefined();
		expect(cells[5]).toMatchObject({ value: '1.50 s', note: 'p50 400 ms' });
	});

	it('keeps the errors cell calm below the alert threshold', () => {
		const cells = headlineCells({ ...totals, errors: 2, denied: 1 }, null, []);
		expect(cells[3]).toMatchObject({ value: '3.0%', alert: false });
	});

	it('does not alert on an empty window', () => {
		const cells = headlineCells({ ...totals, requests: 0, errors: 0, denied: 0 }, null, []);
		expect(cells[3]).toMatchObject({ value: '0.0%', alert: false });
	});
});

describe('token meters', () => {
	it('drops empty meters and computes shares', () => {
		const rows = meterRows(
			[
				{ key: 'input', tokens: 30 },
				{ key: 'output', tokens: 0 },
				{ key: 'cacheRead', tokens: 10 }
			],
			40
		);
		expect(rows.map((r) => [r.key, r.share])).toEqual([
			['input', 0.75],
			['cacheRead', 0.25]
		]);
		expect(rows[0]?.label).toBeTruthy();
	});

	it('derives list cost and saved share', () => {
		expect(cacheSavings({ costUsd: 6, savedUsd: 1, providerCacheSavedUsd: 1 })).toEqual({
			totalSaved: 2,
			listCost: 8,
			savedShare: 0.25
		});
		expect(cacheSavings({ costUsd: 0, savedUsd: 0, providerCacheSavedUsd: 0 }).savedShare).toBe(0);
	});
});

describe('efficiency', () => {
	it('needs two priced models to name extremes', () => {
		expect(priceExtremes([{ costPer1kTokens: 1 }, { costPer1kTokens: 0 }])).toEqual({
			cheapest: null,
			dearest: null
		});
		const ex = priceExtremes([
			{ costPer1kTokens: 1 },
			{ costPer1kTokens: 3 },
			{ costPer1kTokens: 2 }
		]);
		expect(ex).toEqual({ cheapest: 1, dearest: 3 });
		expect(priceExtreme(1, ex)).toBe('cheapest');
		expect(priceExtreme(3, ex)).toBe('dearest');
		expect(priceExtreme(2, ex)).toBeNull();
		expect(priceExtreme(0, { cheapest: 0, dearest: null })).toBeNull();
	});
});
