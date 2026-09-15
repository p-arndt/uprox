import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	createOrgModelPrice,
	deleteOrgModelPrice,
	estimateCost,
	getEffectivePriceMap,
	invalidatePriceCache
} from '$lib/server/pricing';
import { loadRateCards, ratesFor } from '$lib/server/usage-queries/rate-cards';

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
