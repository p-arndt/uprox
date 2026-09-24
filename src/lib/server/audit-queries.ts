/** Read side of the audit log for the admin UI. */
import { and, desc, eq, inArray, like, notLike, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, auditLog, machineToken } from '$lib/server/db/schema';
import { AUDIT_PAGE_SIZE, AUDIT_RANGES, type AuditFilter } from '$lib/audit-view';

const STATUS_VALUES = {
	ok: ['ok', 'allow'],
	denied: ['deny'],
	error: ['error']
} as const;

/** Escape LIKE wildcards so a search for "50%" or "gpt_4" matches literally. */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereFor(filter: AuditFilter): SQL | undefined {
	const conditions: SQL[] = [];
	if (filter.status) conditions.push(inArray(auditLog.status, [...STATUS_VALUES[filter.status]]));
	if (filter.kind === 'gateway') conditions.push(like(auditLog.action, 'gateway.%'));
	if (filter.kind === 'admin') conditions.push(notLike(auditLog.action, 'gateway.%'));
	if (filter.range) {
		conditions.push(
			sql`${auditLog.createdAt} >= now() - make_interval(hours => ${AUDIT_RANGES[filter.range]})`
		);
	}
	if (filter.q) {
		const pattern = `%${escapeLike(filter.q)}%`;
		conditions.push(
			sql`concat_ws(' ', ${auditLog.action}, ${auditLog.status}, ${auditLog.model}, ${auditLog.provider}, ${auditLog.detail}, ${auditLog.ip}, ${service.name}, ${machineToken.name}) ilike ${pattern}`
		);
	}
	if (filter.cursor) {
		// Keyset on (created_at, id) read from the cursor row itself: a JS Date
		// would drop the microseconds Postgres stores and skip or repeat rows.
		conditions.push(
			sql`(${auditLog.createdAt}, ${auditLog.id}) < (select c.created_at, c.id from audit_log c where c.id = ${filter.cursor})`
		);
	}
	return conditions.length ? and(...conditions) : undefined;
}

function selectAudit(filter: AuditFilter, limit: number) {
	return db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			status: auditLog.status,
			provider: auditLog.provider,
			model: auditLog.model,
			statusCode: auditLog.statusCode,
			costUsd: auditLog.costUsd,
			providerCachedTokens: auditLog.providerCachedTokens,
			latencyMs: auditLog.latencyMs,
			ip: auditLog.ip,
			detail: auditLog.detail,
			serviceName: service.name,
			tokenName: machineToken.name,
			createdAt: auditLog.createdAt
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.leftJoin(machineToken, eq(machineToken.id, auditLog.tokenId))
		.where(whereFor(filter))
		.orderBy(desc(auditLog.createdAt), desc(auditLog.id))
		.limit(limit);
}

export type AuditRow = Awaited<ReturnType<typeof selectAudit>>[number];

export function listAudit(limit = 100) {
	return selectAudit({}, limit);
}

/**
 * One page of the filtered log, newest first. `nextCursor` is set only when
 * another page exists, found by reading one row past the page.
 */
export async function listAuditPage(
	filter: AuditFilter,
	limit = AUDIT_PAGE_SIZE
): Promise<{ entries: AuditRow[]; nextCursor: string | null }> {
	const rows = await selectAudit(filter, limit + 1);
	const entries = rows.slice(0, limit);
	return {
		entries,
		nextCursor: rows.length > limit ? (entries.at(-1)?.id ?? null) : null
	};
}
