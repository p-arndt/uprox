/**
 * Backfill the cost of gateway requests that were recorded without one because
 * their model had no price at the time. Once a price exists (added by hand or by
 * the LiteLLM sync), the stored token counts are enough to cost them exactly as
 * the gateway would have: same resolver, same tier rule, same cache fallbacks.
 *
 * Only rows with a NULL cost and recorded input tokens are touched, so a run is
 * idempotent and never rewrites a cost that was billed at the time. Backfilled
 * spend counts toward budgets like any other, including the current window.
 */
import { and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import { getEffectivePriceMap } from '$lib/server/pricing';
import { contextTierForPromptTokens, costFromPrice, resolvePrice } from '$lib/server/providers';

const BATCH_SIZE = 1000;

/** Rows that reported usage but carry no cost — what the partial index covers. */
const unpriced = and(isNull(auditLog.costUsd), isNotNull(auditLog.inputTokens));

export interface UnpricedModel {
	model: string;
	requests: number;
	/** true when a price now resolves for this model, i.e. it can be backfilled */
	priceable: boolean;
}

export interface UnpricedSummary {
	/** requests that can be priced now */
	priceable: number;
	/** requests whose model still has no price */
	missing: number;
	/** per model, most requests first */
	models: UnpricedModel[];
}

/** The unpriced backlog per model, and which of it the current prices can cover. */
export async function unpricedSummary(): Promise<UnpricedSummary> {
	const rows = await db
		.select({ model: auditLog.model, requests: sql<number>`count(*)::int` })
		.from(auditLog)
		.where(and(unpriced, isNotNull(auditLog.model)))
		.groupBy(auditLog.model);
	const prices = await getEffectivePriceMap();
	const models = rows
		.map((r) => ({
			model: r.model!,
			requests: Number(r.requests),
			priceable: resolvePrice(prices, r.model!) != null
		}))
		.sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model));
	let priceable = 0;
	let missing = 0;
	for (const m of models) {
		if (m.priceable) priceable += m.requests;
		else missing += m.requests;
	}
	return { priceable, missing, models };
}

/**
 * Cost every unpriced request whose model has a price now. Returns how many
 * rows were updated. Works in batches; a row only matches until it is priced,
 * so each pass shrinks the set and the loop ends.
 */
export async function backfillMissingCosts(): Promise<number> {
	const prices = await getEffectivePriceMap();
	const { models } = await unpricedSummary();
	const targets = models.filter((m) => m.priceable).map((m) => m.model);
	if (targets.length === 0) return 0;

	let updated = 0;
	for (;;) {
		const batch = await db
			.select({
				id: auditLog.id,
				model: auditLog.model,
				inputTokens: auditLog.inputTokens,
				outputTokens: auditLog.outputTokens,
				cacheRead: auditLog.providerCachedTokens,
				cacheWrite: auditLog.cacheWriteTokens
			})
			.from(auditLog)
			.where(and(unpriced, inArray(auditLog.model, targets)))
			.limit(BATCH_SIZE);
		if (batch.length === 0) break;

		const values = batch.map((r) => {
			const price = resolvePrice(prices, r.model!)!;
			const prompt = r.inputTokens!;
			const cost = costFromPrice(
				price,
				prompt,
				r.outputTokens ?? 0,
				r.cacheRead ?? 0,
				r.cacheWrite ?? 0
			);
			const tier = contextTierForPromptTokens(price, prompt);
			return sql`(${r.id}::uuid, ${String(cost)}::numeric, ${tier}::text)`;
		});
		// postgres-js resolves `execute` to the row array, so RETURNING gives the count
		const result = (await db.execute(sql`
			update ${auditLog} set cost_usd = v.cost, context_tier = v.tier
			from (values ${sql.join(values, sql`, `)}) as v(id, cost, tier)
			where ${auditLog.id} = v.id and ${auditLog.costUsd} is null
			returning ${auditLog.id}
		`)) as unknown as unknown[];
		const count = result.length;
		updated += count;
		// nothing changed (rows priced concurrently): stop rather than spin
		if (count === 0) break;
	}
	return updated;
}
