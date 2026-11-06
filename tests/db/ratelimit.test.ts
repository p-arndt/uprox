import { describe, expect, it } from 'vitest';
import { db } from '$lib/server/db';
import { machineToken, rateLimitWindow, service } from '$lib/server/db/schema';
import { checkRateLimit } from '$lib/server/ratelimit';

let seq = 0;
async function newToken(): Promise<string> {
	const n = seq++;
	const [svc] = await db
		.insert(service)
		.values({ name: `svc-${n}` })
		.returning();
	const [tok] = await db
		.insert(machineToken)
		.values({
			serviceId: svc!.id,
			name: `tok-${n}`,
			display: `uprox_${n}`,
			hashedToken: `hash-${n}`
		})
		.returning();
	return tok!.id;
}

describe('checkRateLimit (real SQL)', () => {
	it('treats a limit of 0 (or negative) as unlimited and writes nothing', async () => {
		const id = await newToken();
		expect(await checkRateLimit(id, 0)).toEqual({ ok: true });
		expect(await checkRateLimit(id, -5)).toEqual({ ok: true });
		expect(await db.select().from(rateLimitWindow)).toHaveLength(0);
	});

	// PGlite has one connection, so these upserts don't truly overlap; the
	// cross-connection race relies on ON CONFLICT ... WHERE being atomic in Postgres.
	it('admits exactly the limit under concurrency and rejects the rest', async () => {
		const id = await newToken();
		const results = await Promise.all(Array.from({ length: 5 }, () => checkRateLimit(id, 3)));
		const ok = results.filter((r) => r.ok);
		const rejected = results.filter((r) => !r.ok);

		expect(ok).toHaveLength(3);
		expect(ok.map((r) => r.remaining).sort()).toEqual([0, 1, 2]);
		expect(rejected).toHaveLength(2);
		for (const r of rejected) {
			expect(r).toMatchObject({ limit: 3, remaining: 0 });
			expect(r.retryAfter).toBeGreaterThanOrEqual(1);
			expect(r.retryAfter).toBeLessThanOrEqual(60);
		}
	});

	it('keeps separate windows per token', async () => {
		const a = await newToken();
		const b = await newToken();
		expect((await checkRateLimit(a, 1)).ok).toBe(true);
		expect((await checkRateLimit(a, 1)).ok).toBe(false);
		expect((await checkRateLimit(b, 1)).ok).toBe(true);
	});
});
