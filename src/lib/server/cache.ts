/**
 * Exact-match response cache for the gateway. Caching is opt-in per policy
 * (`cacheTtlSeconds > 0`) and only applies to deterministic-by-default,
 * non-streaming endpoints (chat completions, embeddings). Entries are scoped
 * to an organization and keyed by a hash of the upstream target plus a
 * canonicalized request body, so byte-for-byte identical requests replay the
 * stored upstream response for free.
 *
 * This is *exact*-match, not semantic: it won't match paraphrased prompts. It
 * pays off for repeated, identical calls (idempotent retries, hot prompts,
 * embedding the same corpus) and never risks returning a response for a
 * different request.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { responseCache } from '$lib/server/db/schema';
import { sha256 } from '$lib/server/crypto';

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

/** Build the cache key for a request. */
export function cacheKeyFor(provider: string, path: string, body: unknown): string {
	return sha256(`${provider}\n${path}\n${JSON.stringify(canonicalize(body))}`);
}

export interface CachedResponse {
	response: string;
	statusCode: number;
}

/** Look up a live (unexpired) cache entry and bump its hit counter. */
export async function getCached(orgId: string, cacheKey: string): Promise<CachedResponse | null> {
	const [row] = await db
		.select({
			id: responseCache.id,
			response: responseCache.response,
			statusCode: responseCache.statusCode
		})
		.from(responseCache)
		.where(
			and(
				eq(responseCache.organizationId, orgId),
				eq(responseCache.cacheKey, cacheKey),
				gt(responseCache.expiresAt, new Date())
			)
		)
		.limit(1);
	if (!row) return null;

	// best-effort hit accounting; don't block the response on it
	void db
		.update(responseCache)
		.set({ hits: sql`${responseCache.hits} + 1` })
		.where(eq(responseCache.id, row.id))
		.catch(() => {});

	return { response: row.response, statusCode: row.statusCode };
}

/**
 * Largest response we'll cache. Buffered streams can be sizable; past this we
 * skip the write rather than bloat the row (and the next request just re-runs).
 */
const MAX_CACHED_BYTES = 1_000_000;

/**
 * Store a successful upstream response. Upserts on (org, key) so a refreshed
 * response replaces a stale one and resets the TTL. Never throws — a cache
 * write must not break the request it's recording.
 */
export async function putCached(opts: {
	organizationId: string;
	cacheKey: string;
	provider: string;
	model: string | null;
	statusCode: number;
	response: string;
	ttlSeconds: number;
}): Promise<void> {
	if (opts.response.length > MAX_CACHED_BYTES) return;
	const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000);
	try {
		await db
			.insert(responseCache)
			.values({
				organizationId: opts.organizationId,
				cacheKey: opts.cacheKey,
				provider: opts.provider,
				model: opts.model,
				statusCode: opts.statusCode,
				response: opts.response,
				hits: 0,
				expiresAt
			})
			.onConflictDoUpdate({
				target: [responseCache.organizationId, responseCache.cacheKey],
				set: { response: opts.response, statusCode: opts.statusCode, expiresAt, hits: 0 }
			});
	} catch (err) {
		console.error('[cache] failed to store entry', err);
	}
}
