/**
 * Postgres-backed fixed-window rate limiter, keyed by machine-token id.
 *
 * The limit (requests per minute) comes from the token's policy. Counters live
 * in `rate_limit_window` (one row per token and minute), so every replica sees
 * the same count and the limit holds across restarts. The window boundary is
 * taken from the database clock, so replicas with skewed clocks still agree.
 *
 * ponytail: fixed one-minute window, so a caller can burst up to 2× the limit
 * across a minute boundary. Upgrade path: a sliding window weighted from the
 * current and previous bucket (both rows already exist). One hot row per token
 * and minute, so a token doing thousands of req/min serializes on that row
 * lock; batch counts in memory per replica if that ever shows up.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';

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
 * Rejected requests are not counted.
 */
export async function checkRateLimit(
	tokenId: string,
	limitPerMinute: number
): Promise<RateLimitResult> {
	if (!limitPerMinute || limitPerMinute <= 0) return { ok: true };

	// The upsert only increments while count < limit; no returned row = rejected.
	// The second branch reports how long the (shared) window still runs.
	let rows: { count: number | null; seconds_left: string | number }[];
	try {
		rows = await countHit(tokenId, limitPerMinute);
	} catch (err) {
		// Fail open: a DB blip (or a token deleted mid-request, FK violation) must
		// not turn a best-effort guard into a gateway outage.
		console.error('[ratelimit] check failed, admitting request', err);
		return { ok: true };
	}

	const row = rows[0];
	if (row?.count == null) {
		const retryAfter = Math.max(1, Math.ceil(Number(row?.seconds_left ?? 60)));
		return { ok: false, retryAfter, limit: limitPerMinute, remaining: 0 };
	}
	return { ok: true, limit: limitPerMinute, remaining: limitPerMinute - row.count };
}

async function countHit(tokenId: string, limitPerMinute: number) {
	return (await db.execute(sql`
		with hit as (
			insert into rate_limit_window (token_id, window_start, count)
			values (${tokenId}, date_trunc('minute', now()), 1)
			on conflict (token_id, window_start) do update
				set count = rate_limit_window.count + 1
				where rate_limit_window.count < ${limitPerMinute}
			returning count
		)
		select
			(select count from hit) as count,
			extract(epoch from date_trunc('minute', now()) + interval '1 minute' - now()) as seconds_left
	`)) as unknown as { count: number | null; seconds_left: string | number }[];
}

/**
 * Drop windows that are long over. Every replica runs this; the delete is
 * idempotent, so overlapping sweeps are harmless.
 */
const sweep = setInterval(() => {
	db.execute(
		sql`delete from rate_limit_window where window_start < now() - interval '2 minutes'`
	).catch((err) => console.error('[ratelimit] sweep failed', err));
}, 60_000);
// don't keep the process alive just for the sweep
if (typeof sweep === 'object' && 'unref' in sweep) sweep.unref();
import.meta.hot?.dispose(() => clearInterval(sweep));
