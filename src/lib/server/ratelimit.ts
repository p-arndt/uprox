/**
 * In-memory sliding-window rate limiter, keyed by machine-token id.
 *
 * The limit (requests per minute) comes from the token's policy. This is a
 * single-instance, best-effort limiter: the window lives in process memory, so
 * it resets on restart and is not shared across replicas. That's an acceptable
 * trade-off for the monolith MVP — it protects the gateway from runaway
 * callers without a Redis dependency. When the gateway is split out and scaled
 * horizontally, swap this module for a shared store (Redis token bucket)
 * behind the same `checkRateLimit` signature.
 */

/** tokenId → ascending list of request timestamps (ms) within the window */
const windows = new Map<string, number[]>();

const WINDOW_MS = 60_000;

export interface RateLimitResult {
	ok: boolean;
	/** seconds the caller should wait before retrying (only when !ok) */
	retryAfter?: number;
	/** the configured ceiling, for response headers */
	limit?: number;
	/** requests remaining in the current window (only when ok) */
	remaining?: number;
}

/**
 * Record a request against `tokenId` and decide whether it's allowed.
 * `limitPerMinute` of 0 (or less) means unlimited — always allowed, untracked.
 */
export function checkRateLimit(tokenId: string, limitPerMinute: number): RateLimitResult {
	if (!limitPerMinute || limitPerMinute <= 0) return { ok: true };

	const now = Date.now();
	const cutoff = now - WINDOW_MS;

	const hits = (windows.get(tokenId) ?? []).filter((t) => t > cutoff);

	if (hits.length >= limitPerMinute) {
		// oldest hit falls out of the window at hits[0] + WINDOW_MS
		const retryAfter = Math.max(1, Math.ceil((hits[0] + WINDOW_MS - now) / 1000));
		windows.set(tokenId, hits);
		return { ok: false, retryAfter, limit: limitPerMinute, remaining: 0 };
	}

	hits.push(now);
	windows.set(tokenId, hits);
	return { ok: true, limit: limitPerMinute, remaining: limitPerMinute - hits.length };
}

/**
 * Periodically drop windows that have fully aged out so the map doesn't grow
 * unbounded for tokens that stop making requests. Best-effort; cheap.
 */
const sweep = setInterval(() => {
	const cutoff = Date.now() - WINDOW_MS;
	for (const [tokenId, hits] of windows) {
		const live = hits.filter((t) => t > cutoff);
		if (live.length === 0) windows.delete(tokenId);
		else windows.set(tokenId, live);
	}
}, WINDOW_MS);
// don't keep the process alive just for the sweep
if (typeof sweep === 'object' && 'unref' in sweep) sweep.unref();
