/** Read side of the audit log for the admin UI. */
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, auditLog } from '$lib/server/db/schema';

export function listAudit(limit = 100) {
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
			createdAt: auditLog.createdAt
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.orderBy(desc(auditLog.createdAt))
		.limit(limit);
}
