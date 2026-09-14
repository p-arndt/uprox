/**
 * In-process TTL cache for cost-analysis query results.
 *
 * Every filter pill, group-by change and refresh re-runs the usage page's load,
 * and most of those navigations re-ask questions already answered seconds ago
 * (the totals don't change when only the grouping does). Results are cached per
 * process, keyed by everything that shapes the query.
 *
 * Windows that are over (yesterday, last month, a custom range in the past, the
 * previous period of a closed window) can't change and get a long TTL. Windows
 * still receiving traffic get a short one, which bounds how stale a figure can
 * be. The loader's `fresh=1` bypasses reads so the refresh button always shows
 * current data (and re-primes the cache).
 *
 * Pending promises are cached, so concurrent requests for the same key share
 * one query; a rejected load is evicted so the next request retries.
 */
import type { ResolvedRange } from '$lib/features/usage/range';
import type { UsageFilter } from '$lib/features/usage/group';

export const CLOSED_WINDOW_TTL_MS = 10 * 60_000;
export const ROLLING_WINDOW_TTL_MS = 30_000;
export const USAGE_CACHE_MAX_ENTRIES = 200;

export interface UsageCacheOptions {
	maxEntries?: number;
	/** clock, injectable for tests */
	now?: () => number;
}

export interface UsageCache {
	/**
	 * The cached value for `key`, or the result of `load` (cached for `ttlMs`).
	 * With `fresh`, any cached value is ignored and replaced.
	 */
	fetch<T>(key: string, ttlMs: number, load: () => Promise<T>, fresh?: boolean): Promise<T>;
	readonly size: number;
	clear(): void;
}

export function createUsageCache(opts: UsageCacheOptions = {}): UsageCache {
	const maxEntries = opts.maxEntries ?? USAGE_CACHE_MAX_ENTRIES;
	const now = opts.now ?? Date.now;
	// Map iteration order is insertion order, so the first key is the oldest.
	const entries = new Map<string, { expires: number; value: Promise<unknown> }>();

	return {
		fetch<T>(key: string, ttlMs: number, load: () => Promise<T>, fresh = false): Promise<T> {
			const hit = entries.get(key);
			if (hit && !fresh && hit.expires > now()) return hit.value as Promise<T>;

			const value = load();
			// re-insert so a refreshed key counts as the newest
			entries.delete(key);
			entries.set(key, { expires: now() + ttlMs, value });
			value.catch(() => {
				if (entries.get(key)?.value === value) entries.delete(key);
			});
			while (entries.size > maxEntries) {
				const oldest = entries.keys().next().value as string;
				entries.delete(oldest);
			}
			return value;
		},
		get size() {
			return entries.size;
		},
		clear() {
			entries.clear();
		}
	};
}

/** How a query window is identified in a cache key, and how long it may be cached. */
export interface CacheWindow {
	id: string;
	ttlMs: number;
}

/**
 * The cache identity of a window. A rolling window ("7d", "today") has no fixed
 * bounds — its start moves with the clock — so it is identified by its preset
 * key and cached briefly. The previous period of a rolling window slides with
 * it and is treated the same way (pass the current window as `previousOf`). A
 * bounded window is identified by its bounds, and is closed once its end has
 * passed.
 */
export function cacheWindow(
	range: ResolvedRange,
	opts: { now: number; previousOf?: ResolvedRange }
): CacheWindow {
	const anchor = opts.previousOf ?? range;
	if (!anchor.end || !range.end) {
		return {
			id: `rolling:${anchor.key}${opts.previousOf ? ':previous' : ''}`,
			ttlMs: ROLLING_WINDOW_TTL_MS
		};
	}
	const closed = range.end.getTime() <= opts.now;
	return {
		id: `${range.start.toISOString()}/${range.end.toISOString()}`,
		ttlMs: closed ? CLOSED_WINDOW_TTL_MS : ROLLING_WINDOW_TTL_MS
	};
}

/**
 * A stable cache key. Filters are normalised (dimensions and values sorted),
 * because their order doesn't change the query: values OR within a dimension,
 * dimensions AND together.
 */
export function usageCacheKey(parts: {
	query: string;
	window: CacheWindow;
	serviceId?: string;
	tokenId?: string;
	dim?: string;
	filters?: UsageFilter[];
	bucket?: string;
	/** anything else that shapes the result (limits, dimension lists) */
	extra?: unknown;
}): string {
	const filters = (parts.filters ?? [])
		.map((f) => [f.dim, [...f.values].sort()] as const)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return JSON.stringify([
		parts.query,
		parts.window.id,
		parts.serviceId ?? null,
		parts.tokenId ?? null,
		parts.dim ?? null,
		filters,
		parts.bucket ?? null,
		parts.extra ?? null
	]);
}

/** The process-wide cache the usage loader uses. */
export const usageCache = createUsageCache();
