import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkRateLimit } from '$lib/server/ratelimit';

// The limiter keeps per-token state in a process-global Map, so every test uses
// a unique tokenId to stay isolated from the others.
let n = 0;
const uniqueToken = () => `tok-${Date.now()}-${n++}`;

afterEach(() => {
	vi.useRealTimers();
});

describe('checkRateLimit', () => {
	it('treats a limit of 0 (or negative) as unlimited and untracked', () => {
		const id = uniqueToken();
		for (let i = 0; i < 100; i++) expect(checkRateLimit(id, 0).ok).toBe(true);
		expect(checkRateLimit(uniqueToken(), -5).ok).toBe(true);
	});

	it('allows up to the limit, then blocks with retry-after and the ceiling', () => {
		const id = uniqueToken();
		expect(checkRateLimit(id, 3)).toMatchObject({ ok: true, remaining: 2 });
		expect(checkRateLimit(id, 3)).toMatchObject({ ok: true, remaining: 1 });
		expect(checkRateLimit(id, 3)).toMatchObject({ ok: true, remaining: 0 });

		const blocked = checkRateLimit(id, 3);
		expect(blocked.ok).toBe(false);
		expect(blocked.limit).toBe(3);
		expect(blocked.remaining).toBe(0);
		expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
		expect(blocked.retryAfter).toBeLessThanOrEqual(60);
	});

	it('keeps separate windows per token', () => {
		const a = uniqueToken();
		const b = uniqueToken();
		expect(checkRateLimit(a, 1).ok).toBe(true);
		expect(checkRateLimit(a, 1).ok).toBe(false); // a exhausted
		expect(checkRateLimit(b, 1).ok).toBe(true); // b untouched
	});

	it('lets requests through again once the 60s window slides past', () => {
		vi.useFakeTimers();
		const id = uniqueToken();
		expect(checkRateLimit(id, 1).ok).toBe(true);
		expect(checkRateLimit(id, 1).ok).toBe(false);

		// advance just past the window; the old hit ages out
		vi.advanceTimersByTime(60_001);
		expect(checkRateLimit(id, 1).ok).toBe(true);
	});

	it('reports a retry-after that shrinks as the window ages', () => {
		vi.useFakeTimers();
		const id = uniqueToken();
		checkRateLimit(id, 1); // one hit at t=0
		const early = checkRateLimit(id, 1).retryAfter!; // blocked, ~60s left
		vi.advanceTimersByTime(30_000);
		const later = checkRateLimit(id, 1).retryAfter!; // blocked, ~30s left
		expect(later).toBeLessThan(early);
	});
});
