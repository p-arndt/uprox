/** Token meter decomposition of spend. */
import { and, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import type { BucketChoice, ResolvedRange } from '$lib/usage-range';
import type { UsageFilter } from '$lib/usage-group';
import {
	METER_ORDER,
	splitMeters,
	meterListCosts,
	providerCacheSaving,
	allocateCost,
	addMeterValues,
	emptyMeterValues,
	sumMeterValues,
	type MeterKey,
	type MeterTokenSums
} from '$lib/usage-meters';
import { usageConds } from '$lib/server/usage-queries/predicates';
import type { GroupedSeries, GroupedSeriesResult } from '$lib/server/usage-queries/types';
import { METER_SUM_SELECT, meterLabel } from '$lib/server/usage-queries/meter-sql';
import { ALL_LINES, bucketedMeterCells } from '$lib/server/usage-queries/meter-cells';
import { loadRateCards, ratesFor } from '$lib/server/usage-queries/rate-cards';

/**
 * One consumption meter — uprox's answer to an Azure "meter", the sub-line a
 * resource's cost decomposes into. The vocabulary and the arithmetic live in
 * `$lib/usage-meters`; this layer only supplies the sums.
 */
export interface TokenMeter {
	key: MeterKey;
	tokens: number;
	/**
	 * Actual spend attributed to this meter. Derived by pricing each meter at its
	 * own list rate and then scaling so the meters sum to the spend actually
	 * recorded — an allocation, not an independent measurement, because the
	 * provider bills one number per request and never itemises it. Scaling is what
	 * keeps the meters reconciling with the headline instead of drifting whenever
	 * a price row is edited after the fact.
	 */
	costUsd: number;
}

export interface TokenMeterBreakdown {
	meters: TokenMeter[];
	/** every metered token in the window — the meters sum to exactly this */
	totalTokens: number;
	/** actual spend recorded for the window */
	costUsd: number;
	/** exact USD uprox's own response cache avoided (replayed requests) */
	savedUsd: number;
	/** input tokens uprox replayed from its response cache (never sent upstream) */
	savedInputTokens: number;
	savedOutputTokens: number;
	/**
	 * Estimated USD the *provider's* prompt cache avoided: cache-read tokens
	 * priced at the delta between full input and the cache-read rate, per model.
	 * An estimate, unlike savedUsd — the provider bills the discount, it doesn't
	 * itemise it — so it is always labelled as such in the UI.
	 */
	providerCacheSavedUsd: number;
}

/**
 * Decompose the window's token volume into its billing meters, with the cost
 * each caching layer avoided.
 *
 * Grouped per (model, tier) rather than over the window as a whole: each group
 * is priced at its own rate card, and its list split is reconciled against its
 * own recorded spend, so one mispriced model can't shift the attribution of
 * every other. The meters still partition the window exactly.
 */
export async function orgTokenMeters(
	range: ResolvedRange,
	opts: { filters?: UsageFilter[]; serviceId?: string; tokenId?: string } = {}
): Promise<TokenMeterBreakdown> {
	const conds = usageConds(range, opts.serviceId, opts.tokenId, opts.filters);

	const rows = await db
		.select({
			model: auditLog.model,
			tier: auditLog.contextTier,
			...METER_SUM_SELECT,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			saved: sql<string>`coalesce(sum(${auditLog.savedUsd}), 0)::text`,
			savedInput: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			savedOutput: sql<number>`coalesce(sum(${auditLog.savedOutputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.where(and(...conds))
		.groupBy(auditLog.model, auditLog.contextTier);

	const prices = await loadRateCards();

	const tokens = emptyMeterValues();
	const costs = emptyMeterValues();
	let costUsd = 0;
	let savedUsd = 0;
	let savedInputTokens = 0;
	let savedOutputTokens = 0;
	let providerCacheSavedUsd = 0;

	for (const r of rows) {
		const sums: MeterTokenSums = {
			inputTokens: Number(r.inputTokens ?? 0),
			outputTokens: Number(r.outputTokens ?? 0),
			cacheReadTokens: Number(r.cacheReadTokens ?? 0),
			cacheWriteTokens: Number(r.cacheWriteTokens ?? 0),
			embeddingInputTokens: Number(r.embeddingInputTokens ?? 0),
			embeddingOutputTokens: Number(r.embeddingOutputTokens ?? 0)
		};
		const rowCost = Number(r.cost ?? 0);
		const rates = ratesFor(prices, r.model, r.tier);

		addMeterValues(tokens, splitMeters(sums));
		addMeterValues(costs, allocateCost(meterListCosts(sums, rates), splitMeters(sums), rowCost));

		costUsd += rowCost;
		savedUsd += Number(r.saved ?? 0);
		savedInputTokens += Number(r.savedInput ?? 0);
		savedOutputTokens += Number(r.savedOutput ?? 0);
		providerCacheSavedUsd += providerCacheSaving(sums, rates);
	}

	const meters: TokenMeter[] = METER_ORDER.map((key) => ({
		key,
		tokens: tokens[key],
		costUsd: costs[key]
	}));

	return {
		meters,
		totalTokens: sumMeterValues(tokens),
		costUsd,
		savedUsd,
		savedInputTokens,
		savedOutputTokens,
		providerCacheSavedUsd
	};
}

/**
 * The token meters bucketed over time, shaped as a {@link GroupedSeriesResult}
 * so the cost-analysis stacked chart can render it unchanged — same tooltip,
 * axis and 100%-stacked mode, no second charting path to keep in step.
 *
 * Answers the question the single composition bar can't: whether the mix is
 * *moving*. A cache-read share climbing week over week is the thing an operator
 * is trying to engineer for, and a flat total can hide it entirely.
 */
export async function orgTokenMetersSeries(
	range: ResolvedRange,
	opts: {
		unit?: BucketChoice;
		filters?: UsageFilter[];
		serviceId?: string;
		tokenId?: string;
	} = {}
): Promise<GroupedSeriesResult> {
	const { unit, buckets, cells } = await bucketedMeterCells(range, opts);

	const series: GroupedSeries[] = METER_ORDER.map((key) => {
		const points = buckets.map((_, b) => {
			const cell = cells[b].get(ALL_LINES);
			return {
				requests: 0,
				denied: 0,
				costUsd: cell?.costs[key] ?? 0,
				tokens: cell?.tokens[key] ?? 0
			};
		});
		return {
			key,
			label: meterLabel(key),
			hint: null,
			points,
			costUsd: points.reduce((a, c) => a + c.costUsd, 0),
			requests: 0,
			tokens: points.reduce((a, c) => a + c.tokens, 0)
		};
	}).filter((x) => x.tokens > 0);

	return { unit, buckets, series, hasOthers: false };
}
