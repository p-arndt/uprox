import { describe, expect, it, vi } from 'vitest';
import {
	CLOSED_WINDOW_TTL_MS,
	ROLLING_WINDOW_TTL_MS,
	cacheWindow,
	createUsageCache,
	usageCacheKey
} from '$lib/server/usage-cache';
import type { ResolvedRange } from '$lib/usage-range';

function clock(start = 1_000_000) {
	let t = start;
	return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createUsageCache', () => {
	it('serves a hit within the TTL and reloads after it expires', async () => {
		const c = clock();
		const cache = createUsageCache({ now: c.now });
		const load = vi.fn(async () => 'v');

		await cache.fetch('k', 1000, load);
		await cache.fetch('k', 1000, load);
		expect(load).toHaveBeenCalledTimes(1);

		c.advance(999);
		await cache.fetch('k', 1000, load);
		expect(load).toHaveBeenCalledTimes(1);

		c.advance(1);
		await cache.fetch('k', 1000, load);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('shares one pending load between concurrent callers', async () => {
		const cache = createUsageCache();
		let resolve!: (v: number) => void;
		const load = vi.fn(() => new Promise<number>((r) => (resolve = r)));
		const a = cache.fetch('k', 1000, load);
		const b = cache.fetch('k', 1000, load);
		resolve(42);
		await expect(Promise.all([a, b])).resolves.toEqual([42, 42]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('bypasses and replaces the cached value when fresh', async () => {
		const cache = createUsageCache();
		let n = 0;
		const load = async () => ++n;
		expect(await cache.fetch('k', 1000, load)).toBe(1);
		expect(await cache.fetch('k', 1000, load, true)).toBe(2);
		// the fresh result primed the cache
		expect(await cache.fetch('k', 1000, load)).toBe(2);
	});

	it('evicts a rejected load so the next call retries', async () => {
		const cache = createUsageCache();
		await expect(cache.fetch('k', 1000, () => Promise.reject(new Error('x')))).rejects.toThrow();
		await Promise.resolve();
		expect(cache.size).toBe(0);
		expect(await cache.fetch('k', 1000, async () => 'ok')).toBe('ok');
	});

	it('evicts the oldest entries beyond the bound', async () => {
		const cache = createUsageCache({ maxEntries: 2 });
		const load = vi.fn(async () => 1);
		await cache.fetch('a', 1000, load);
		await cache.fetch('b', 1000, load);
		await cache.fetch('c', 1000, load);
		expect(cache.size).toBe(2);
		await cache.fetch('b', 1000, load);
		await cache.fetch('c', 1000, load);
		expect(load).toHaveBeenCalledTimes(3);
		await cache.fetch('a', 1000, load);
		expect(load).toHaveBeenCalledTimes(4);
	});
});

describe('cacheWindow', () => {
	const now = Date.UTC(2026, 8, 14, 12);
	const day = 86_400_000;

	it('identifies rolling windows by preset and caches them briefly', () => {
		const rolling: ResolvedRange = { key: '7d', start: new Date(now - 7 * day) };
		const later: ResolvedRange = { key: '7d', start: new Date(now - 7 * day + 5000) };
		expect(cacheWindow(rolling, { now })).toEqual({
			id: 'rolling:7d',
			ttlMs: ROLLING_WINDOW_TTL_MS
		});
		expect(cacheWindow(later, { now }).id).toBe('rolling:7d');
	});

	it('treats the previous period of a rolling window as rolling too', () => {
		const current: ResolvedRange = { key: '7d', start: new Date(now - 7 * day) };
		const previous: ResolvedRange = {
			key: '7d',
			start: new Date(now - 14 * day),
			end: current.start
		};
		expect(cacheWindow(previous, { now, previousOf: current })).toEqual({
			id: 'rolling:7d:previous',
			ttlMs: ROLLING_WINDOW_TTL_MS
		});
	});

	it('gives bounded windows in the past the long TTL, and open ones the short', () => {
		const past: ResolvedRange = {
			key: 'last-month',
			start: new Date(Date.UTC(2026, 7, 1)),
			end: new Date(Date.UTC(2026, 8, 1))
		};
		expect(cacheWindow(past, { now })).toEqual({
			id: '2026-08-01T00:00:00.000Z/2026-09-01T00:00:00.000Z',
			ttlMs: CLOSED_WINDOW_TTL_MS
		});
		const endsTomorrow: ResolvedRange = {
			key: 'custom',
			start: new Date(Date.UTC(2026, 8, 1)),
			end: new Date(Date.UTC(2026, 8, 15))
		};
		expect(cacheWindow(endsTomorrow, { now }).ttlMs).toBe(ROLLING_WINDOW_TTL_MS);
	});
});

describe('usageCacheKey', () => {
	const window = { id: 'rolling:7d', ttlMs: ROLLING_WINDOW_TTL_MS };

	it('is independent of filter and value order', () => {
		const a = usageCacheKey({
			query: 'totals',
			window,
			filters: [
				{ dim: 'model', values: ['b', 'a'] },
				{ dim: 'provider', values: ['x'] }
			]
		});
		const b = usageCacheKey({
			query: 'totals',
			window,
			filters: [
				{ dim: 'provider', values: ['x'] },
				{ dim: 'model', values: ['a', 'b'] }
			]
		});
		expect(a).toBe(b);
	});

	it('distinguishes every part that shapes the query', () => {
		const base = { query: 'byDimension', window, dim: 'model', bucket: 'auto' };
		const keys = new Set([
			usageCacheKey(base),
			usageCacheKey({ ...base, query: 'series' }),
			usageCacheKey({ ...base, window: { ...window, id: 'rolling:30d' } }),
			usageCacheKey({ ...base, serviceId: 's' }),
			usageCacheKey({ ...base, tokenId: 's' }),
			usageCacheKey({ ...base, dim: 'provider' }),
			usageCacheKey({ ...base, bucket: 'day' }),
			usageCacheKey({ ...base, filters: [{ dim: 'model', values: ['a'] }] }),
			usageCacheKey({ ...base, extra: ['model'] })
		]);
		expect(keys.size).toBe(9);
	});
});
