import { describe, expect, it } from 'vitest';
import {
	latencyPercentiles,
	percentileCont,
	type LatencyBucket
} from '$lib/server/usage-queries/latency';

/** Expand a histogram back into its raw sample, for a reference computation. */
const expand = (buckets: LatencyBucket[]) =>
	buckets.flatMap((b) => Array.from({ length: b.count }, () => b.latencyMs));

/** Reference percentile_cont over a raw sample. */
function reference(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const pos = p * (sorted.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

describe('percentileCont', () => {
	it('is null for an empty histogram', () => {
		expect(percentileCont([], 0.5)).toBeNull();
		expect(percentileCont([{ latencyMs: 10, count: 0 }], 0.5)).toBeNull();
	});

	it('returns the only value of a single-bucket histogram', () => {
		expect(percentileCont([{ latencyMs: 42, count: 7 }], 0.95)).toBe(42);
	});

	it('interpolates between neighbours like Postgres', () => {
		// sample 1, 2, 3, 4: median position 1.5 -> 2.5
		const h = [1, 2, 3, 4].map((v) => ({ latencyMs: v, count: 1 }));
		expect(percentileCont(h, 0.5)).toBe(2.5);
		// p95 position 2.85 -> 3.85
		expect(percentileCont(h, 0.95)).toBeCloseTo(3.85, 10);
	});

	it('handles unsorted buckets and interpolation across bucket boundaries', () => {
		const h = [
			{ latencyMs: 300, count: 2 },
			{ latencyMs: 100, count: 3 },
			{ latencyMs: 200, count: 1 }
		];
		for (const p of [0, 0.1, 0.5, 0.75, 0.95, 1]) {
			expect(percentileCont(h, p)).toBeCloseTo(reference(expand(h), p) as number, 10);
		}
	});

	it('matches the reference on a pseudo-random sample', () => {
		let seed = 7;
		const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 5000;
		const counts = new Map<number, number>();
		for (let i = 0; i < 2000; i++) {
			const v = Math.round(rand());
			counts.set(v, (counts.get(v) ?? 0) + 1);
		}
		const h = [...counts].map(([latencyMs, count]) => ({ latencyMs, count }));
		for (const p of [0.5, 0.95, 0.99]) {
			expect(percentileCont(h, p)).toBeCloseTo(reference(expand(h), p) as number, 8);
		}
	});
});

describe('latencyPercentiles', () => {
	it('rounds to whole milliseconds and keeps null when unmeasured', () => {
		const h = [1, 2].map((v) => ({ latencyMs: v, count: 1 }));
		expect(latencyPercentiles(h)).toEqual({ latencyP50: 2, latencyP95: 2 });
		expect(latencyPercentiles([])).toEqual({ latencyP50: null, latencyP95: null });
	});
});
