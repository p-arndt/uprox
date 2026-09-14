/** Rate-card billing lines (model x tier x meter). */
import { and, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import { resolveSeriesBucket, type BucketChoice, type ResolvedRange } from '$lib/usage-range';
import { NULL_VALUE, OTHERS_KEY, encodeBillingLineKey, type UsageFilter } from '$lib/usage-group';
import {
	METER_ORDER,
	splitMeters,
	meterListCosts,
	allocateCost,
	sumMeterValues,
	effectiveRatePerMtok,
	type MeterKey,
	type MeterTokenSums
} from '$lib/usage-meters';
import { usageConds } from '$lib/server/usage-queries/predicates';
import type {
	DimensionUsageRow,
	GroupedSeries,
	GroupedSeriesResult
} from '$lib/server/usage-queries/types';
import { METER_SUM_SELECT, meterShortLabel } from '$lib/server/usage-queries/meter-sql';
import { bucketedMeterCells } from '$lib/server/usage-queries/meter-cells';
import { loadRateCards, ratesFor } from '$lib/server/usage-queries/rate-cards';

/**
 * The window's spend as a list of rate-card lines: one row per
 * (model × context tier × meter), the level a cloud bill calls a "meter" and
 * the level at which a figure is checkable against a published price.
 *
 * This is what "group by model" can't tell you. Two models with the same monthly
 * total are a different problem depending on whether the money went to fresh
 * input (send less context), to output (ask for shorter answers), to cache
 * writes (the TTL is wrong) or to a long-context rate card (the prompt crossed a
 * threshold and every token got more expensive). Each of those is a separate
 * line here, with the unit price beside it.
 */
export async function orgBillingLines(
	range: ResolvedRange,
	opts: { filters?: UsageFilter[]; limit?: number; serviceId?: string; tokenId?: string } = {}
): Promise<DimensionUsageRow[]> {
	const conds = usageConds(range, opts.serviceId, opts.tokenId, opts.filters);

	const rows = await db
		.select({
			model: auditLog.model,
			tier: auditLog.contextTier,
			// a model is served by a single provider; max() picks a stable non-null id
			provider: sql<string | null>`max(${auditLog.provider})`,
			...METER_SUM_SELECT,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`
		})
		.from(auditLog)
		.where(and(...conds))
		.groupBy(auditLog.model, auditLog.contextTier);

	const prices = await loadRateCards();
	const lines: DimensionUsageRow[] = [];

	for (const r of rows) {
		const sums: MeterTokenSums = {
			inputTokens: Number(r.inputTokens ?? 0),
			outputTokens: Number(r.outputTokens ?? 0),
			cacheReadTokens: Number(r.cacheReadTokens ?? 0),
			cacheWriteTokens: Number(r.cacheWriteTokens ?? 0),
			embeddingInputTokens: Number(r.embeddingInputTokens ?? 0),
			embeddingOutputTokens: Number(r.embeddingOutputTokens ?? 0)
		};
		const tokens = splitMeters(sums);
		const costs = allocateCost(
			meterListCosts(sums, ratesFor(prices, r.model, r.tier)),
			tokens,
			Number(r.cost ?? 0)
		);
		const model = r.model ?? NULL_VALUE;
		const tier = r.tier ?? NULL_VALUE;

		for (const meter of METER_ORDER) {
			// A meter with no volume isn't a line on the bill, so it isn't a row.
			if (tokens[meter] <= 0) continue;
			lines.push({
				key: encodeBillingLineKey({ model, tier, meter }),
				label: billingLineLabel(model, tier, meter),
				hint: r.provider,
				costUsd: costs[meter],
				// A request feeds several meters at once, so "requests per line" has no
				// meaning; left at zero rather than invented. Same for denials, which
				// never produced a token in the first place.
				requests: 0,
				denied: 0,
				// The embedding line carries both halves, so it reports them honestly
				// rather than parking its completion tokens under "input".
				inputTokens: meter === 'embedding' ? sums.embeddingInputTokens : tokens[meter],
				outputTokens:
					meter === 'embedding'
						? sums.embeddingOutputTokens
						: meter === 'output'
							? tokens[meter]
							: 0,
				ratePerMtok: effectiveRatePerMtok(costs[meter], tokens[meter])
			});
		}
	}

	lines.sort((a, b) => b.costUsd - a.costUsd || b.inputTokens - a.inputTokens);
	return opts.limit ? lines.slice(0, opts.limit) : lines;
}

/**
 * A line's display name: model, the rate card it billed against when that isn't
 * the ordinary one, then the meter. Long context earns a segment of its own
 * because it *is* a different price for the same model — the single most
 * surprising line on a bill, and invisible under any other grouping.
 */
function billingLineLabel(model: string, tier: string, meter: MeterKey): string {
	const name = model === NULL_VALUE ? 'No model' : model;
	// Kept deliberately terse: three parts have to fit one legend entry, and the
	// model is the part a reader scans for, so it must not be the part that gets
	// truncated. Hence "Long" over "Long context" and the short meter names.
	const card = tier === 'long' ? ' · Long' : '';
	return `${name}${card} · ${meterShortLabel(meter)}`;
}

/**
 * The billing lines bucketed over time, with everything past the top-N folded
 * into `Others` exactly as the column-backed dimensions do.
 *
 * Folding matters more here than anywhere else: the line dimension is the cross
 * product of three vocabularies, so a busy window carries hundreds of them and
 * an unfolded stack would be unreadable long before it was slow.
 */
export async function orgBillingLineSeries(
	range: ResolvedRange,
	opts: {
		unit?: BucketChoice;
		filters?: UsageFilter[];
		limit?: number;
		serviceId?: string;
		tokenId?: string;
		/** the unlimited {@link orgBillingLines} ranking, when already computed */
		ranked?: DimensionUsageRow[];
	} = {}
): Promise<GroupedSeriesResult> {
	const ranked =
		opts.ranked ??
		(await orgBillingLines(range, {
			filters: opts.filters,
			serviceId: opts.serviceId,
			tokenId: opts.tokenId
		}));
	const top = ranked.slice(0, opts.limit ?? 8);
	const topKeys = new Set(top.map((r) => r.key));
	const hasOthers = ranked.length > top.length;

	// Nothing to stack. Returns empty arrays rather than a padded axis — and skips
	// the bucketed read entirely, since there is nothing left for it to fill.
	if (top.length === 0) {
		return {
			unit: resolveSeriesBucket(range, opts.unit ?? 'auto'),
			buckets: [],
			series: [],
			hasOthers: false
		};
	}

	const { unit, buckets, cells } = await bucketedMeterCells(range, opts, { perLine: true });

	const axis = hasOthers ? [...top.map((r) => r.key), OTHERS_KEY] : top.map((r) => r.key);
	const labels = new Map(top.map((r) => [r.key, r.label] as const));

	const series: GroupedSeries[] = axis.map((key) => {
		const points = buckets.map((_, b) => {
			let costUsd = 0;
			let tokens = 0;
			for (const [lineKey, cell] of cells[b]) {
				const folded = topKeys.has(lineKey) ? lineKey : OTHERS_KEY;
				if (folded !== key) continue;
				costUsd += sumMeterValues(cell.costs);
				tokens += sumMeterValues(cell.tokens);
			}
			return { requests: 0, denied: 0, costUsd, tokens };
		});
		return {
			key,
			label: key === OTHERS_KEY ? 'Others' : (labels.get(key) ?? key),
			hint: null,
			points,
			costUsd: points.reduce((a, c) => a + c.costUsd, 0),
			requests: 0,
			tokens: points.reduce((a, c) => a + c.tokens, 0)
		};
	});

	return { unit, buckets, series, hasOthers };
}
