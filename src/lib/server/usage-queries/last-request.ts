/** The most recent gateway request, regardless of window. */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import type { UsageFilter } from '$lib/features/usage/group';
import { filterCond } from '$lib/server/usage-queries/predicates';

/**
 * When the last gateway request in scope happened, as an ISO string, or null
 * when there has never been one. Unbounded in time on purpose: it is what an
 * empty window points at ("the traffic is further back than this") and, called
 * without scope or filters, the all-time "has anything ever been proxied" check.
 * `max(created_at)` reads the end of the created_at index rather than scanning.
 */
export async function lastRequestAt(
	opts: { serviceId?: string; tokenId?: string; filters?: UsageFilter[] } = {}
): Promise<string | null> {
	const [row] = await db
		// mapWith: a raw aggregate would otherwise skip the column's Date mapping
		.select({ at: sql<Date | null>`max(${auditLog.createdAt})`.mapWith(auditLog.createdAt) })
		.from(auditLog)
		.where(
			and(
				sql`${auditLog.action} like 'gateway.%'`,
				opts.serviceId ? eq(auditLog.serviceId, opts.serviceId) : undefined,
				opts.tokenId ? eq(auditLog.tokenId, opts.tokenId) : undefined,
				...(opts.filters ?? []).map(filterCond)
			)
		);
	return row?.at ? row.at.toISOString() : null;
}
