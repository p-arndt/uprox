import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import { orgDailyStats } from '$lib/server/usage-queries/overview';

/** A `created_at` value `days` whole days before now, computed by the database clock. */
const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`;

describe('orgDailyStats (real SQL)', () => {
	beforeEach(async () => {
		await db.delete(auditLog);
	});

	it('returns one zero-filled row per day when there is no traffic', async () => {
		const stats = await orgDailyStats(7);

		expect(stats).toHaveLength(7);
		expect(stats.every((d) => d.requests === 0 && d.denied === 0 && d.costUsd === 0)).toBe(true);
	});

	it('counts gateway requests per day and ignores other actions and old rows', async () => {
		await db.insert(auditLog).values([
			{ action: 'gateway.chat', status: 'ok', costUsd: '0.500000', createdAt: daysAgo(0) },
			{ action: 'gateway.chat', status: 'deny', costUsd: '0.250000', createdAt: daysAgo(0) },
			{ action: 'gateway.embeddings', status: 'ok', costUsd: '0.100000', createdAt: daysAgo(2) },
			// not gateway traffic
			{ action: 'token.create', status: 'ok', createdAt: daysAgo(0) },
			// outside the 14-day window
			{ action: 'gateway.chat', status: 'ok', costUsd: '9.000000', createdAt: daysAgo(30) }
		]);

		const stats = await orgDailyStats(14);

		expect(stats).toHaveLength(14);
		// oldest-first, ISO dates
		expect(stats.map((d) => d.date)).toEqual([...stats.map((d) => d.date)].sort());
		expect(stats[13]).toMatchObject({ requests: 2, denied: 1, costUsd: 0.75 });
		expect(stats[11]).toMatchObject({ requests: 1, denied: 0, costUsd: 0.1 });
		expect(stats.reduce((sum, d) => sum + d.requests, 0)).toBe(3);
	});
});

describe('partial unique indexes (raw SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from model_price`);
	});

	const insertPrice = (model: string, isDefault: boolean) =>
		db.execute(sql`
			insert into model_price (model, is_default, input_per_mtok, output_per_mtok)
			values (${model}, ${isDefault}, 1, 2)
		`);

	it('allows one default and one custom price per model', async () => {
		await insertPrice('gpt-test', true);
		await insertPrice('gpt-test', false);

		const rows = (await db.execute(sql`
			select model, is_default from model_price
			where model = 'gpt-test' and is_default = false
		`)) as unknown as { model: string; is_default: boolean }[];

		expect(rows).toEqual([{ model: 'gpt-test', is_default: false }]);
	});

	it('rejects a second default price for the same model', async () => {
		await insertPrice('gpt-test', true);

		await expect(insertPrice('gpt-test', true)).rejects.toThrow();
	});
});
