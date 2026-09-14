import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';
import type { ContextTier } from '$lib/server/providers';

export interface AuditEntry {
	action: string;
	status: 'allow' | 'deny' | 'error' | 'ok';
	serviceId?: string | null;
	tokenId?: string | null;
	provider?: string | null;
	model?: string | null;
	statusCode?: number | null;
	costUsd?: number | null;
	savedUsd?: number | null;
	/** LLM tokens consumed (prompt / completion), as reported by the upstream */
	inputTokens?: number | null;
	outputTokens?: number | null;
	/** for cache hits: tokens the original (miss) request consumed — saved by replay */
	savedInputTokens?: number | null;
	savedOutputTokens?: number | null;
	/** input tokens the upstream provider served from its own prompt cache (cache read) */
	providerCachedTokens?: number | null;
	/** input tokens written to the provider's prompt cache (Anthropic cache creation) */
	cacheWriteTokens?: number | null;
	/** the rate card the request billed against; null when nothing was priced */
	contextTier?: ContextTier | null;
	latencyMs?: number | null;
	ip?: string | null;
	detail?: string | null;
}

/** Anything that can run the audit insert: the pool itself or an open transaction. */
export type AuditExecutor = Pick<typeof db, 'insert'>;

/**
 * Append a row to the audit trail through `executor`, throwing on failure.
 * Use this inside a transaction so a failed audit write rolls the whole unit of
 * work back — a swallowed error would leave the transaction aborted and its
 * commit silently discarded. Returns the new row's id.
 */
export async function insertAudit(executor: AuditExecutor, entry: AuditEntry): Promise<string> {
	const [row] = await executor
		.insert(auditLog)
		.values({
			action: entry.action,
			status: entry.status,
			serviceId: entry.serviceId ?? null,
			tokenId: entry.tokenId ?? null,
			provider: entry.provider ?? null,
			model: entry.model ?? null,
			statusCode: entry.statusCode ?? null,
			costUsd: entry.costUsd != null ? entry.costUsd.toFixed(6) : null,
			savedUsd: entry.savedUsd != null ? entry.savedUsd.toFixed(6) : null,
			inputTokens: entry.inputTokens ?? null,
			outputTokens: entry.outputTokens ?? null,
			savedInputTokens: entry.savedInputTokens ?? null,
			savedOutputTokens: entry.savedOutputTokens ?? null,
			providerCachedTokens: entry.providerCachedTokens ?? null,
			cacheWriteTokens: entry.cacheWriteTokens ?? null,
			contextTier: entry.contextTier ?? null,
			latencyMs: entry.latencyMs ?? null,
			ip: entry.ip ?? null,
			detail: entry.detail ?? null
		})
		.returning({ id: auditLog.id });
	return row.id;
}

/**
 * Append a row to the audit trail. Never throws — auditing must not break the
 * request it is recording. Returns the new row's id (or null if the insert
 * failed), so a caller can attach a request trace to it; see recordTrace.
 */
export async function audit(entry: AuditEntry): Promise<string | null> {
	try {
		return await insertAudit(db, entry);
	} catch (err) {
		console.error('[audit] failed to write entry', err);
		return null;
	}
}
