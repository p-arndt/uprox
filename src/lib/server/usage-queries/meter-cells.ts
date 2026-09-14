/** Bucketed meter cells shared by the meter and billing-line series. */
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import {
	resolveSeriesBucket,
	type BucketChoice,
	type ResolvedRange,
	type SeriesBucket
} from '$lib/usage-range';
import { NULL_VALUE, encodeBillingLineKey, type UsageFilter } from '$lib/usage-group';
import {
	METER_ORDER,
	splitMeters,
	meterListCosts,
	allocateCost,
	emptyMeterValues,
	type MeterValues
} from '$lib/usage-meters';
import { BUCKET_STEP } from '$lib/server/usage-queries/buckets';
import { usageCondsSql } from '$lib/server/usage-queries/predicates';
import {
	METER_SUM_SQL,
	type RawMeterSums,
	meterSumsFromRow
} from '$lib/server/usage-queries/meter-sql';
import { loadRateCards, ratesFor } from '$lib/server/usage-queries/rate-cards';

/**
 * The key the meter series aggregates under when it isn't splitting per line —
 * a single bucket-wide cell. Not a valid billing-line key, and never rendered.
 */
export const ALL_LINES = '*';

export interface MeterCell {
	tokens: MeterValues;
	costs: MeterValues;
}

/**
 * The shared read behind both meter-flavoured time series: tokens and allocated
 * cost per (bucket, model, tier), reduced into per-bucket cells.
 *
 * Cost is allocated per (model, tier) group against that group's own recorded
 * spend before it's summed into a bucket, so a bucket's bands always add up to
 * the spend that bucket actually recorded — no second reconciliation pass, and
 * no cross-subsidy between a priced model and an unpriced one.
 *
 * The `generate_series` left join pads empty buckets, which come back as one row
 * with a null model and zero sums.
 */
export async function bucketedMeterCells(
	range: ResolvedRange,
	opts: { unit?: BucketChoice; filters?: UsageFilter[]; serviceId?: string; tokenId?: string },
	shape: { perLine?: boolean } = {}
): Promise<{ unit: SeriesBucket; buckets: string[]; cells: Map<string, MeterCell>[] }> {
	const unit = resolveSeriesBucket(range, opts.unit ?? 'auto');
	const step = BUCKET_STEP[unit];
	const startIso = range.start.toISOString();
	const upperIso = (range.end ?? new Date()).toISOString();
	const scope = sql.join(
		[
			...(opts.serviceId ? [sql`${auditLog.serviceId} = ${opts.serviceId}::uuid`] : []),
			...(opts.tokenId ? [sql`${auditLog.tokenId} = ${opts.tokenId}::uuid`] : [])
		].map((c) => sql` and ${c}`),
		sql``
	);

	const rows = await db.execute<
		RawMeterSums & { bucket: string; model: string | null; tier: string | null; cost: string }
	>(sql`
		select
			to_char(g.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket,
			${auditLog.model} as model,
			${auditLog.contextTier} as tier,
			${METER_SUM_SQL},
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost
		from generate_series(
			date_trunc(${unit}, ${startIso}::timestamp),
			date_trunc(${unit}, ${upperIso}::timestamp),
			${step}::interval
		) as g(bucket)
		left join ${auditLog}
			on date_trunc(${unit}, ${auditLog.createdAt}) = g.bucket
			and ${usageCondsSql(range, opts.filters)}${scope}
		group by g.bucket, ${auditLog.model}, ${auditLog.contextTier}
		order by g.bucket asc
	`);

	const prices = await loadRateCards();
	const buckets: string[] = [];
	const idx = new Map<string, number>();
	const cells: Map<string, MeterCell>[] = [];

	for (const r of rows) {
		if (!idx.has(r.bucket)) {
			idx.set(r.bucket, buckets.length);
			buckets.push(r.bucket);
			cells.push(new Map());
		}
		const bucket = cells[idx.get(r.bucket)!];
		const sums = meterSumsFromRow(r);
		const tokens = splitMeters(sums);
		const costs = allocateCost(
			meterListCosts(sums, ratesFor(prices, r.model, r.tier)),
			tokens,
			Number(r.cost ?? 0)
		);
		const model = r.model ?? NULL_VALUE;
		const tier = r.tier ?? NULL_VALUE;

		// One cell per line when the caller splits by line, one shared cell when it
		// only wants the meters — the same reduction either way.
		for (const meter of METER_ORDER) {
			if (tokens[meter] <= 0 && costs[meter] === 0) continue;
			const key = shape.perLine ? encodeBillingLineKey({ model, tier, meter }) : ALL_LINES;
			let cell = bucket.get(key);
			if (!cell) {
				cell = { tokens: emptyMeterValues(), costs: emptyMeterValues() };
				bucket.set(key, cell);
			}
			cell.tokens[meter] += tokens[meter];
			cell.costs[meter] += costs[meter];
		}
	}

	return { unit, buckets, cells };
}
