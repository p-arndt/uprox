import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import { createOrgModelPrice, invalidatePriceCache } from '$lib/server/pricing';
import { backfillMissingCosts, unpricedSummary } from '$lib/server/cost-backfill';

const request = (model: string | null, extra: Partial<typeof auditLog.$inferInsert> = {}) => ({
	action: 'gateway.chat',
	status: 'ok',
	model,
	inputTokens: 1_000_000,
	outputTokens: 100_000,
	...extra
});

const costs = async () =>
	(
		(await db.execute(
			sql`select model, cost_usd, context_tier from audit_log where action like 'gateway.%' order by model, cost_usd`
		)) as unknown as {
			model: string | null;
			cost_usd: string | null;
			context_tier: string | null;
		}[]
	).map((r) => [r.model, r.cost_usd == null ? null : Number(r.cost_usd), r.context_tier]);

describe('cost backfill (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from audit_log`);
		await db.execute(sql`delete from model_price`);
		invalidatePriceCache();
	});

	it('summarises the backlog per model and whether a price now resolves', async () => {
		await db
			.insert(auditLog)
			.values([request('acme-1'), request('acme-1'), request('nobody-knows')]);
		await createOrgModelPrice({ model: 'acme', inputPerMtok: 1, outputPerMtok: 10 });

		expect(await unpricedSummary()).toEqual({
			priceable: 2,
			missing: 1,
			models: [
				{ model: 'acme-1', requests: 2, priceable: true },
				{ model: 'nobody-knows', requests: 1, priceable: false }
			]
		});
	});

	it('costs only unpriced rows with usage, like the gateway would, and is idempotent', async () => {
		await db.insert(auditLog).values([
			// 1M in @ $1 (200k of it cache reads @ 0.1×) + 100k out @ $10
			request('acme-1', { providerCachedTokens: 200_000 }),
			// already billed at the time: never rewritten
			request('acme-1', { costUsd: '9.000000', contextTier: 'standard' }),
			// no usage (a denial / cache hit): nothing to price
			request('acme-1', { inputTokens: null, outputTokens: null, status: 'deny' }),
			request('nobody-knows')
		]);
		await createOrgModelPrice({ model: 'acme', inputPerMtok: 1, outputPerMtok: 10 });

		expect(await backfillMissingCosts()).toBe(1);
		expect(await costs()).toEqual([
			['acme-1', 1.82, 'standard'],
			['acme-1', 9, 'standard'],
			['acme-1', null, null],
			['nobody-knows', null, null]
		]);
		expect(await backfillMissingCosts()).toBe(0);
		expect((await unpricedSummary()).priceable).toBe(0);
	});

	it('applies the long-context card and its per-model threshold', async () => {
		await db.insert(auditLog).values(request('acme-long', { outputTokens: 0 }));
		await createOrgModelPrice({
			model: 'acme-long',
			inputPerMtok: 1,
			outputPerMtok: 1,
			longInputPerMtok: 2,
			longMinPromptTokens: 500_000
		});
		await backfillMissingCosts();
		expect(await costs()).toEqual([['acme-long', 2, 'long']]);
	});

	it('works through more rows than one batch', async () => {
		await db
			.insert(auditLog)
			.values(Array.from({ length: 1_205 }, () => request('acme-1', { outputTokens: 0 })));
		await createOrgModelPrice({ model: 'acme', inputPerMtok: 1, outputPerMtok: 1 });
		expect(await backfillMissingCosts()).toBe(1_205);
		expect((await unpricedSummary()).priceable).toBe(0);
	});
});
