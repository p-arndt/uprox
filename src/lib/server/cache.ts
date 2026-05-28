/**
 * Exact-match response cache for the gateway. Caching is enabled by a non-zero
 * TTL (instance-wide default, overridable per policy) and applies to chat
 * completions, embeddings, and the Responses API — streamed or buffered.
 * Entries are shared
 * instance-wide and keyed by a hash of the upstream target plus a
 * canonicalized request body, so byte-for-byte identical requests replay the
 * stored upstream response for free.
 *
 * This is *exact*-match, not semantic: it won't match paraphrased prompts. It
 * pays off for repeated, identical calls (idempotent retries, hot prompts,
 * embedding the same corpus) and never risks returning a response for a
 * different request.
 *
 * It is also gated on *determinism* (see `isDeterministicRequest`): a chat
 * request only caches when the caller pinned sampling, so two identical but
 * intentionally-varied prompts ("Hi" at the default temperature 1) each hit the
 * model instead of replaying one stored answer.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { responseCache } from '$lib/server/db/schema';
import { sha256 } from '$lib/server/crypto';

/**
 * Top-level request fields that don't affect the model's output, so they're
 * dropped before hashing — two requests that differ only in these still share a
 * cache entry. `user` is an end-user tag for abuse monitoring; `metadata` is
 * arbitrary developer tagging on the Responses API; `store` only controls
 * server-side persistence, not the content.
 */
const IGNORED_KEYS = new Set(['user', 'metadata', 'store']);

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Whether a request's output is *meant* to be reproducible, so replaying a
 * cached response is what the caller wants rather than a surprise.
 *
 * - Embeddings are deterministic by nature — always cacheable.
 * - Chat/Responses are only deterministic when sampling is pinned: an explicit
 *   `temperature` of 0, or a `seed` (same seed → reproducible output). With the
 *   API default of `temperature: 1` and no seed, the caller expects variety, so
 *   the request is treated as uncacheable even when byte-identical to a prior one.
 * - Any other scope is not cached.
 */
export function isDeterministicRequest(scope: string, body: unknown): boolean {
	if (scope === 'embeddings') return true;
	if (scope !== 'chat' && scope !== 'responses') return false;
	if (!isRecord(body)) return false;
	if (body.seed != null) return true;
	return typeof body.temperature === 'number' && body.temperature === 0;
}

/** Recursively sort object keys so semantically-equal bodies hash the same. */
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = canonicalize((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}

/** Build the cache key for a request, ignoring output-irrelevant noise fields. */
export function cacheKeyFor(provider: string, path: string, body: unknown): string {
	let normalized = body;
	if (body && typeof body === 'object' && !Array.isArray(body)) {
		normalized = Object.fromEntries(
			Object.entries(body as Record<string, unknown>).filter(([k]) => !IGNORED_KEYS.has(k))
		);
	}
	return sha256(`${provider}\n${path}\n${JSON.stringify(canonicalize(normalized))}`);
}

export interface CachedResponse {
	response: string;
	statusCode: number;
	/** what the original (miss) response was billed — the exact amount this hit saves */
	costUsd: number | null;
}

/** Look up a live (unexpired) cache entry and bump its hit counter. */
export async function getCached(cacheKey: string): Promise<CachedResponse | null> {
	const [row] = await db
		.select({
			id: responseCache.id,
			response: responseCache.response,
			statusCode: responseCache.statusCode,
			costUsd: responseCache.costUsd
		})
		.from(responseCache)
		.where(and(eq(responseCache.cacheKey, cacheKey), gt(responseCache.expiresAt, new Date())))
		.limit(1);
	if (!row) return null;

	// best-effort hit accounting; don't block the response on it
	void db
		.update(responseCache)
		.set({ hits: sql`${responseCache.hits} + 1` })
		.where(eq(responseCache.id, row.id))
		.catch(() => {});

	return {
		response: row.response,
		statusCode: row.statusCode,
		costUsd: row.costUsd != null ? Number(row.costUsd) : null
	};
}

/**
 * Largest response we'll cache. Buffered streams can be sizable; past this we
 * skip the write rather than bloat the row (and the next request just re-runs).
 */
const MAX_CACHED_BYTES = 1_000_000;

/**
 * Store a successful upstream response. Upserts on the cache key so a refreshed
 * response replaces a stale one and resets the TTL. Never throws — a cache
 * write must not break the request it's recording.
 */
export async function putCached(opts: {
	cacheKey: string;
	provider: string;
	model: string | null;
	statusCode: number;
	response: string;
	/** the cost this response was billed at, stored so each hit can report it as saved */
	costUsd: number | null;
	ttlSeconds: number;
}): Promise<void> {
	if (opts.response.length > MAX_CACHED_BYTES) return;
	const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000);
	const costUsd = opts.costUsd != null ? opts.costUsd.toFixed(6) : null;
	try {
		await db
			.insert(responseCache)
			.values({
				cacheKey: opts.cacheKey,
				provider: opts.provider,
				model: opts.model,
				statusCode: opts.statusCode,
				response: opts.response,
				costUsd,
				hits: 0,
				expiresAt
			})
			.onConflictDoUpdate({
				target: responseCache.cacheKey,
				set: { response: opts.response, statusCode: opts.statusCode, costUsd, expiresAt, hits: 0 }
			});
	} catch (err) {
		console.error('[cache] failed to store entry', err);
	}
}
