import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	createOrgModelPrice,
	deleteOrgModelPrice,
	estimateCost,
	getEffectivePriceMap,
	hasSyncedDefaultPrices,
	invalidatePriceCache,
	seedDefaultModelPrices
} from '$lib/server/pricing';
import { loadRateCards, ratesFor } from '$lib/server/usage-queries/rate-cards';
import { DEFAULT_MODEL_PRICES } from '$lib/server/providers';

const insertDefault = (model: string, input: number, output: number) =>
	db.execute(sql`
		insert into model_price (model, is_default, input_per_mtok, output_per_mtok)
		values (${model}, true, ${input}, ${output})
	`);

describe('effective price map (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from model_price`);
		invalidatePriceCache();
	});

	it('layers custom rows over defaults and keys by lower-cased model', async () => {
		await insertDefault('gpt-test', 1, 2);
		await insertDefault('GPT-UPPER', 3, 4);
		await createOrgModelPrice({ model: 'gpt-test', inputPerMtok: 10, outputPerMtok: 20 });

		const map = await getEffectivePriceMap();

		expect(map['gpt-test']).toMatchObject({ in: 10, out: 20 });
		expect(map['gpt-upper']).toMatchObject({ in: 3, out: 4 });
	});

	it('serves gateway estimates and analytics rate cards from the same loader', async () => {
		await insertDefault('gpt-test', 1, 2);

		expect(await loadRateCards()).toBe(await getEffectivePriceMap());
		const estimate = await estimateCost('gpt-test-2026', 1_000_000, 0);
		expect(estimate).toEqual({ costUsd: 1, tier: 'standard' });
		expect(ratesFor(await loadRateCards(), 'gpt-test-2026', 'standard')?.inputPerMtok).toBe(1);
	});

	it('invalidates the cache on writes so both paths see an edit at once', async () => {
		await insertDefault('gpt-test', 1, 2);
		expect((await estimateCost('gpt-test', 1_000_000, 0)).costUsd).toBe(1);

		const row = await createOrgModelPrice({ model: 'gpt-test', inputPerMtok: 5, outputPerMtok: 2 });
		expect((await estimateCost('gpt-test', 1_000_000, 0)).costUsd).toBe(5);
		expect(ratesFor(await loadRateCards(), 'gpt-test', null)?.inputPerMtok).toBe(5);

		await deleteOrgModelPrice(row!.id);
		expect(ratesFor(await loadRateCards(), 'gpt-test', null)?.inputPerMtok).toBe(1);
	});
});

describe('default price seeding (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from model_price`);
		invalidatePriceCache();
	});

	it('round-trips a per-model long-context threshold and bills by it', async () => {
		await seedDefaultModelPrices({
			'claude-haiku-test': {
				in: 0.1,
				out: 0.5,
				longIn: 0.5,
				longOut: 2.5,
				longMinPromptTokens: 100_001
			}
		});
		const map = await getEffectivePriceMap();
		expect(map['claude-haiku-test']).toMatchObject({ longMinPromptTokens: 100_001 });
		expect((await estimateCost('claude-haiku-test', 100_000, 0)).tier).toBe('standard');
		expect(await estimateCost('claude-haiku-test', 100_001, 0)).toEqual({
			costUsd: Math.round(((100_001 * 0.5) / 1e6) * 1e8) / 1e8,
			tier: 'long'
		});
	});

	it('insert-only mode adds missing models but keeps existing defaults', async () => {
		await seedDefaultModelPrices({ 'gpt-synced': { in: 1, out: 2 } });
		await seedDefaultModelPrices(
			{ 'gpt-synced': { in: 9, out: 9 }, 'gpt-new': { in: 3, out: 4 } },
			{ updateExisting: false }
		);
		const map = await getEffectivePriceMap();
		expect(map['gpt-synced']).toMatchObject({ in: 1, out: 2 });
		expect(map['gpt-new']).toMatchObject({ in: 3, out: 4 });
	});

	it('update mode overwrites defaults but never custom overrides', async () => {
		await seedDefaultModelPrices({ 'gpt-synced': { in: 1, out: 2 } });
		await createOrgModelPrice({ model: 'gpt-synced', inputPerMtok: 50, outputPerMtok: 60 });
		await seedDefaultModelPrices({ 'gpt-synced': { in: 5, out: 6 } });
		const rows = (await db.execute(
			sql`select is_default, input_per_mtok from model_price where model = 'gpt-synced' order by is_default`
		)) as unknown as { is_default: boolean; input_per_mtok: string }[];
		expect(rows.map((r) => [r.is_default, Number(r.input_per_mtok)])).toEqual([
			[false, 50],
			[true, 5]
		]);
	});

	it('a full write prunes defaults missing from the map, which marks the sync state', async () => {
		await seedDefaultModelPrices({
			...DEFAULT_MODEL_PRICES,
			'gpt-litellm-only': { in: 1, out: 2 }
		});
		expect(await hasSyncedDefaultPrices()).toBe(true);
		await createOrgModelPrice({ model: 'my-custom', inputPerMtok: 1, outputPerMtok: 1 });

		await seedDefaultModelPrices();
		const map = await getEffectivePriceMap();
		expect(map['gpt-litellm-only']).toBeUndefined();
		expect(map['my-custom']).toMatchObject({ in: 1 });
		expect(map['claude-haiku-5-5']).toMatchObject({ longMinPromptTokens: 100_001 });
		expect(await hasSyncedDefaultPrices()).toBe(false);
	});
});
