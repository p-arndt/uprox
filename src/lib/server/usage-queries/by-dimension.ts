/** Cost-analysis breakdowns and stacked series grouped by any dimension. */
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import { resolveSeriesBucket, type BucketChoice, type ResolvedRange } from '$lib/usage-range';
import {
	NULL_VALUE,
	OTHERS_KEY,
	FILTERABLE_DIMENSIONS,
	type UsageDimension,
	type UsageFilter,
	type UsageFilterOption,
	type UsageFilterOptions
} from '$lib/usage-group';
import { BUCKET_STEP } from '$lib/server/usage-queries/buckets';
import {
	type SqlDimension,
	DIMENSION_SQL,
	DIMENSION_JOIN,
	usageCondsSql
} from '$lib/server/usage-queries/predicates';
import type { DimensionUsageRow, GroupedSeriesResult } from '$lib/features/usage/types';
import { foldGroupedRows } from '$lib/server/usage-queries/row-mapping';
import { meterLabel } from '$lib/server/usage-queries/meter-sql';
import { orgTokenMeters, orgTokenMetersSeries } from '$lib/server/usage-queries/meters';
import { orgBillingLines, orgBillingLineSeries } from '$lib/server/usage-queries/billing-lines';

/**
 * Gateway traffic over the window grouped by an arbitrary dimension, ranked by
 * spend. This is the generalisation of the four hand-written `orgUsageByX`
 * breakdowns above, and the single source for the cost-analysis page's donuts,
 * detail table, and the series ranking the stacked chart stacks in.
 *
 * Ranked by cost (not request count, which the older breakdowns use) because
 * this drives a *cost* analysis: the series worth a colour slot is the expensive
 * one, not merely the chatty one. Ties fall back to request count so a window of
 * all-zero spend still ranks deterministically.
 */
export async function orgUsageByDimension(
	range: ResolvedRange,
	dim: UsageDimension,
	opts: { filters?: UsageFilter[]; limit?: number; serviceId?: string; tokenId?: string } = {}
): Promise<DimensionUsageRow[]> {
	// Neither `meter` nor `line` is a column — both decompose each row's token
	// counts — so they're served by the meter aggregates rather than a group-by.
	if (dim === 'line') {
		return orgBillingLines(range, opts);
	}
	if (dim === 'meter') {
		const b = await orgTokenMeters(range, {
			filters: opts.filters,
			serviceId: opts.serviceId,
			tokenId: opts.tokenId
		});
		return b.meters
			.filter((m) => m.tokens > 0)
			.map((m) => ({
				key: m.key,
				label: meterLabel(m.key),
				hint: null,
				costUsd: m.costUsd,
				// A request contributes to several meters at once, so "requests per
				// meter" has no meaning; left at zero rather than invented.
				requests: 0,
				denied: 0,
				inputTokens: m.key === 'output' ? 0 : m.tokens,
				outputTokens: m.key === 'output' ? m.tokens : 0
			}))
			.sort((x, y) => y.costUsd - x.costUsd);
	}

	const d = DIMENSION_SQL[dim as SqlDimension];
	const join = DIMENSION_JOIN[dim as SqlDimension];
	const scope = [
		...(opts.serviceId ? [sql`${auditLog.serviceId} = ${opts.serviceId}::uuid`] : []),
		...(opts.tokenId ? [sql`${auditLog.tokenId} = ${opts.tokenId}::uuid`] : [])
	];
	const where = sql.join([usageCondsSql(range, opts.filters), ...scope], sql` and `);

	const rows = await db.execute<{
		key: string;
		label: string | null;
		hint: string | null;
		cost: string;
		requests: number;
		denied: number;
		input_tokens: number;
		output_tokens: number;
	}>(sql`
		select
			${d.value} as key,
			${d.label} as label,
			${d.hint ?? sql`null::text`} as hint,
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost,
			count(*)::int as requests,
			(count(*) filter (where ${auditLog.status} = 'deny'))::int as denied,
			coalesce(sum(${auditLog.inputTokens}), 0)::bigint as input_tokens,
			coalesce(sum(${auditLog.outputTokens}), 0)::bigint as output_tokens
		from ${auditLog}
		${join}
		where ${where}
		-- Group by the select ordinal, not by repeating the expression: the NULL
		-- sentinel inside it is a bound parameter, and two occurrences bind as two
		-- distinct placeholders, so Postgres would not recognise them as the same
		-- expression ("must appear in the GROUP BY clause").
		group by 1
		order by coalesce(sum(${auditLog.costUsd}), 0) desc, count(*) desc
		${opts.limit ? sql`limit ${opts.limit}` : sql``}
	`);

	return rows.map((r) => ({
		key: r.key,
		label: r.label ?? fallbackLabel(dim, r.key),
		hint: r.hint,
		costUsd: Number(r.cost ?? 0),
		requests: Number(r.requests ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.input_tokens ?? 0),
		outputTokens: Number(r.output_tokens ?? 0)
	}));
}

/**
 * What to call a series whose joined row no longer exists (a deleted service, a
 * revoked-and-purged token) or whose column was NULL. Naming it explicitly beats
 * showing a bare uuid, and beats dropping the row — the spend was real and still
 * has to reconcile against the total.
 */
function fallbackLabel(dim: UsageDimension, key: string): string {
	if (key === OTHERS_KEY) return 'Others';
	if (key !== NULL_VALUE) return key;
	if (dim === 'service') return 'Deleted service';
	if (dim === 'token') return 'Revoked token';
	if (dim === 'model') return 'No model';
	if (dim === 'provider') return 'Unrouted';
	// a denial, an error or an unpriced model never reached a rate card at all
	if (dim === 'tier') return 'Unpriced';
	// a line always builds its own label, so a bare sentinel can only be Others
	if (dim === 'line') return 'Others';
	return 'Unknown';
}

/**
 * Traffic over the window, bucketed in time AND split by a dimension — the query
 * behind the stacked cost chart.
 *
 * Runs in two passes rather than one: first rank the dimension to find the
 * top-N series, then fetch the time split with everything outside that set
 * folded into a single `Others` band. The alternative — pulling every
 * (bucket, series) pair and rolling up in JS — is unbounded on a dimension like
 * model, where a busy month can carry hundreds of distinct values.
 *
 * The `generate_series × unnest` cross join pads every (bucket, series) cell, so
 * the returned arrays are dense and the chart can index them positionally
 * without gap-checking. A series that was quiet in a bucket gets a real zero.
 */
export async function orgUsageSeriesGrouped(
	range: ResolvedRange,
	dim: UsageDimension,
	opts: {
		unit?: BucketChoice;
		filters?: UsageFilter[];
		/** how many real series get their own band before the rest fold into Others */
		limit?: number;
		/** narrow to one service / token, for the detail pages */
		serviceId?: string;
		tokenId?: string;
		/**
		 * The unlimited {@link orgUsageByDimension} ranking for the same range,
		 * dimension, filters and scope, when the caller already has it — skips
		 * the ranking pass.
		 */
		ranked?: DimensionUsageRow[];
	} = {}
): Promise<GroupedSeriesResult> {
	if (dim === 'line') {
		return orgBillingLineSeries(range, opts);
	}
	if (dim === 'meter') {
		return orgTokenMetersSeries(range, {
			unit: opts.unit,
			filters: opts.filters,
			serviceId: opts.serviceId,
			tokenId: opts.tokenId
		});
	}

	const unit = resolveSeriesBucket(range, opts.unit ?? 'auto');
	const step = BUCKET_STEP[unit];
	const startIso = range.start.toISOString();
	const upperIso = (range.end ?? new Date()).toISOString();
	const limit = opts.limit ?? 8;
	// The page-level scope, applied identically to the ranking pass and the
	// time-split pass so the bands can't sum to more than the scoped total.
	const scope = sql.join(
		[
			...(opts.serviceId ? [sql`${auditLog.serviceId} = ${opts.serviceId}::uuid`] : []),
			...(opts.tokenId ? [sql`${auditLog.tokenId} = ${opts.tokenId}::uuid`] : [])
		].map((c) => sql` and ${c}`),
		sql``
	);

	const ranked =
		opts.ranked ??
		(await orgUsageByDimension(range, dim, {
			filters: opts.filters,
			serviceId: opts.serviceId,
			tokenId: opts.tokenId
		}));
	const top = ranked.slice(0, limit);
	const hasOthers = ranked.length > top.length;

	// Nothing to stack. Returns empty arrays rather than a padded axis: with no
	// series there is no axis to pad against, and the chart's own empty state
	// reads better than a grid of zeroes.
	if (top.length === 0) {
		return { unit, buckets: [], series: [], hasOthers: false };
	}

	const d = DIMENSION_SQL[dim as SqlDimension];
	const topKeys = top.map((r) => r.key);
	const keyList = sql.join(
		topKeys.map((k) => sql`${k}`),
		sql`, `
	);
	// The key each row contributes to: itself if it's a top-N series, else the
	// Others bucket. Computed in SQL so the fold happens before the group-by.
	const foldedKey = sql`(case when ${d.value} in (${keyList}) then ${d.value} else ${OTHERS_KEY} end)`;
	// The axis of series to pad against — the top-N plus Others when non-empty.
	const axisKeys = hasOthers ? [...topKeys, OTHERS_KEY] : topKeys;
	const axisList = sql.join(
		axisKeys.map((k) => sql`${k}`),
		sql`, `
	);

	const rows = await db.execute<{
		bucket: string;
		key: string;
		requests: number;
		denied: number;
		cost: string;
		tokens: number;
	}>(sql`
		select
			to_char(g.bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket,
			k.key as key,
			count(${auditLog.id})::int as requests,
			(count(${auditLog.id}) filter (where ${auditLog.status} = 'deny'))::int as denied,
			coalesce(sum(${auditLog.costUsd}), 0)::text as cost,
			coalesce(sum(coalesce(${auditLog.inputTokens}, 0) + coalesce(${auditLog.outputTokens}, 0)), 0)::bigint as tokens
		from generate_series(
			date_trunc(${unit}, ${startIso}::timestamp),
			date_trunc(${unit}, ${upperIso}::timestamp),
			${step}::interval
		) as g(bucket)
		cross join (select unnest(array[${axisList}]::text[]) as key) as k
		-- no label join here: the grouping expressions read audit_log columns only,
		-- and the display names already came back with the ranking pass above
		left join ${auditLog}
			on date_trunc(${unit}, ${auditLog.createdAt}) = g.bucket
			and ${foldedKey} = k.key
			and ${usageCondsSql(range, opts.filters)}${scope}
		group by g.bucket, k.key
		order by g.bucket asc
	`);

	const meta = new Map(top.map((r) => [r.key, r]));
	const axis = axisKeys.map((key) => ({
		key,
		label: meta.get(key)?.label ?? fallbackLabel(dim, key),
		hint: meta.get(key)?.hint ?? null
	}));
	const { buckets, series } = foldGroupedRows(rows, axis);

	return { unit, buckets, series, hasOthers };
}

/**
 * The values each dimension can be filtered to, derived from the traffic
 * actually present in the window. Deriving from traffic rather than from the
 * service/token tables means the picker never offers a service that hasn't
 * called the gateway — and still offers a deleted one that did.
 *
 * Deliberately computed against the *unfiltered* window so removing a pill can
 * always be undone; a picker that narrowed itself as you filtered would make
 * some combinations unreachable.
 */
export async function orgUsageFilterOptions(
	range: ResolvedRange,
	dims: readonly UsageDimension[],
	opts: {
		limit?: number;
		serviceId?: string;
		tokenId?: string;
		/**
		 * Supplies the unfiltered, unlimited ranking for a dimension (same range and
		 * scope) when the caller already computes it; sliced to `limit` here.
		 */
		loadRanked?: (dim: UsageDimension) => Promise<DimensionUsageRow[]>;
	} = {}
): Promise<UsageFilterOptions> {
	const limit = opts.limit ?? 100;
	const entries = await Promise.all(
		dims.map(async (dim) => {
			// A derived dimension has no SQL predicate behind it, so it can never be
			// filtered on — and running its (expensive) aggregate just to populate a
			// picker nobody can open would be pure waste.
			if (!FILTERABLE_DIMENSIONS.includes(dim)) return [dim, []] as const;
			const rows = opts.loadRanked
				? (await opts.loadRanked(dim)).slice(0, limit)
				: await orgUsageByDimension(range, dim, {
						limit,
						serviceId: opts.serviceId,
						tokenId: opts.tokenId
					});
			const options: UsageFilterOption[] = rows.map((r) => ({
				value: r.key,
				label: r.label,
				hint: r.hint
			}));
			return [dim, options] as const;
		})
	);
	return Object.fromEntries(entries) as UsageFilterOptions;
}
