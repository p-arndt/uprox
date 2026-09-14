/** The shared usage predicate and the dimension to column mapping. */
import { eq, gte, lt, sql } from 'drizzle-orm';
import { service, machineToken, auditLog } from '$lib/server/db/schema';
import type { ResolvedRange } from '$lib/usage-range';
import { NULL_VALUE, type UsageDimension, type UsageFilter } from '$lib/usage-group';
import { LONG_CONTEXT_MIN_PROMPT_TOKENS } from '$lib/pricing';

/**
 * The shared filter for the usage breakdowns: gateway traffic inside a resolved
 * time window, optionally narrowed to one service and/or one machine token.
 * Rolling windows carry no `end`; calendar buckets bound the upper edge
 * exclusively. Pass the result to `and(...)` — `undefined` legs are ignored by
 * drizzle.
 */
export function usageConds(
	range: ResolvedRange,
	serviceId?: string,
	tokenId?: string,
	filters?: UsageFilter[]
) {
	return [
		sql`${auditLog.action} like 'gateway.%'`,
		gte(auditLog.createdAt, range.start),
		range.end ? lt(auditLog.createdAt, range.end) : undefined,
		serviceId ? eq(auditLog.serviceId, serviceId) : undefined,
		tokenId ? eq(auditLog.tokenId, tokenId) : undefined,
		...(filters ?? []).map(filterCond)
	];
}

/**
 * The SQL identity of each groupable dimension. This map is the ONLY place a
 * dimension key becomes a column, which is what keeps the URL-supplied `group=`
 * and `f=` values safe: an unknown key never reaches here (it's rejected by
 * `isUsageDimension` first), and the values themselves are always bound as
 * parameters, never interpolated.
 *
 * `value` is compared and grouped as text — including for the uuid columns — so
 * a hand-edited filter value can't blow up the query with a uuid cast error, and
 * so NULLs (a deleted service, a denial that never resolved a model) collapse to
 * one addressable `NULL_VALUE` bucket instead of vanishing from the grouping.
 */
/**
 * The dimensions that really are a column on `audit_log`. `meter` and `line` are
 * excluded by construction: both are decompositions of a row's token counts, not
 * properties of the row, so typing these maps over this narrower set makes "a
 * derived dimension reached the SQL layer" a compile error rather than a runtime
 * surprise.
 */
export type SqlDimension = Exclude<UsageDimension, 'meter' | 'line'>;

export const DIMENSION_SQL: Record<
	SqlDimension,
	{ value: ReturnType<typeof sql>; label: ReturnType<typeof sql>; hint?: ReturnType<typeof sql> }
> = {
	service: {
		value: sql`coalesce(${auditLog.serviceId}::text, ${NULL_VALUE})`,
		label: sql`max(${service.name})`
	},
	model: {
		value: sql`coalesce(${auditLog.model}, ${NULL_VALUE})`,
		label: sql`max(${auditLog.model})`,
		hint: sql`max(${auditLog.provider})`
	},
	provider: {
		value: sql`coalesce(${auditLog.provider}, ${NULL_VALUE})`,
		label: sql`max(${auditLog.provider})`
	},
	token: {
		value: sql`coalesce(${auditLog.tokenId}::text, ${NULL_VALUE})`,
		label: sql`max(${machineToken.name})`,
		hint: sql`max(${machineToken.display})`
	},
	status: {
		value: sql`coalesce(${auditLog.status}, ${NULL_VALUE})`,
		label: sql`max(${auditLog.status})`
	},
	// The stored values are the bare keys ('standard' | 'long'); the label is
	// spelled out here rather than in the client so the CSV export and the table
	// read the same, and so the threshold that defines the tier is on screen.
	tier: {
		value: sql`coalesce(${auditLog.contextTier}, ${NULL_VALUE})`,
		// No ELSE on purpose: a NULL tier must stay NULL so the row falls through to
		// fallbackLabel's "Unpriced" instead of being called Standard, which would
		// quietly park denials and errors in a real rate card.
		label: sql`max(case ${auditLog.contextTier} when 'long' then 'Long context' when 'standard' then 'Standard' end)`,
		hint: sql`max(case ${auditLog.contextTier} when 'long' then ${`from ${LONG_CONTEXT_MIN_PROMPT_TOKENS / 1000}K prompt tokens`}::text end)`
	}
};

/**
 * The join a dimension needs to resolve its human-readable label. Only the id
 * dimensions need one — a query grouping by model shouldn't pay for the service
 * join. Empty fragments are a no-op when interpolated.
 */
export const DIMENSION_JOIN: Record<SqlDimension, ReturnType<typeof sql>> = {
	service: sql`left join ${service} on ${service.id} = ${auditLog.serviceId}`,
	token: sql`left join ${machineToken} on ${machineToken.id} = ${auditLog.tokenId}`,
	model: sql``,
	provider: sql``,
	status: sql``,
	tier: sql``
};

/** One filter clause: OR within the dimension's values, AND across dimensions. */
export function filterCond(f: UsageFilter) {
	const entry = DIMENSION_SQL[f.dim as SqlDimension];
	// Belt and braces: parseFilters already drops non-filterable dimensions, so a
	// meter can't get here — but a filter with no column must be a no-op rather
	// than a crash or, worse, a silently dropped AND leg.
	if (!entry) return sql`true`;
	const col = entry.value;
	// Each value is its own bound parameter — never interpolated — so the list is
	// inert regardless of what the URL carried.
	const list = sql.join(
		f.values.map((v) => sql`${v}`),
		sql`, `
	);
	return sql`${col} in (${list})`;
}

/**
 * The usage predicate as a single raw-SQL fragment, for the queries built with
 * `db.execute` rather than the query builder (the time-series ones, which need
 * `generate_series`). Same semantics as {@link usageConds}; the bounds are bound
 * as ISO strings cast with `::timestamp` — discarding the `Z` and staying
 * UTC-aligned — because a raw template can't bind a JS `Date`.
 */
export function usageCondsSql(range: ResolvedRange, filters?: UsageFilter[]) {
	const parts = [
		sql`${auditLog.action} like 'gateway.%'`,
		sql`${auditLog.createdAt} >= ${range.start.toISOString()}::timestamp`,
		...(range.end ? [sql`${auditLog.createdAt} < ${range.end.toISOString()}::timestamp`] : []),
		...(filters ?? []).map(filterCond)
	];
	return sql.join(parts, sql` and `);
}
