import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';

export interface AuditEntry {
	organizationId: string;
	action: string;
	status: 'allow' | 'deny' | 'error' | 'ok';
	serviceId?: string | null;
	tokenId?: string | null;
	provider?: string | null;
	model?: string | null;
	statusCode?: number | null;
	costUsd?: number | null;
	savedUsd?: number | null;
	/** input tokens the upstream provider served from its own prompt cache */
	providerCachedTokens?: number | null;
	latencyMs?: number | null;
	ip?: string | null;
	detail?: string | null;
}

/**
 * Append a row to the audit trail. Never throws — auditing must not break the
 * request it is recording.
 */
export async function audit(entry: AuditEntry): Promise<void> {
	try {
		await db.insert(auditLog).values({
			organizationId: entry.organizationId,
			action: entry.action,
			status: entry.status,
			serviceId: entry.serviceId ?? null,
			tokenId: entry.tokenId ?? null,
			provider: entry.provider ?? null,
			model: entry.model ?? null,
			statusCode: entry.statusCode ?? null,
			costUsd: entry.costUsd != null ? entry.costUsd.toFixed(6) : null,
			savedUsd: entry.savedUsd != null ? entry.savedUsd.toFixed(6) : null,
			providerCachedTokens: entry.providerCachedTokens ?? null,
			latencyMs: entry.latencyMs ?? null,
			ip: entry.ip ?? null,
			detail: entry.detail ?? null
		});
	} catch (err) {
		console.error('[audit] failed to write entry', err);
	}
}
