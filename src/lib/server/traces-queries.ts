/** Captured request traces and ingested OTLP spans for the trace viewer. */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, auditLog, requestTrace, traceSpan } from '$lib/server/db/schema';
import type { MetaFilter } from '$lib/features/traces/trace';

/**
 * List captured request traces for the trace viewer, newest first. Joins the
 * paired audit row for the metadata (status, model, cost, tokens, latency) and
 * the service name; payloads are loaded lazily by {@link getTrace} on the detail
 * view, so the list query stays light.
 */
export function listTraces(limit = 100) {
	return db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			format: requestTrace.responseFormat,
			groupId: requestTrace.traceGroupId,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.orderBy(desc(requestTrace.createdAt))
		.limit(limit);
}

/**
 * Clustered feed for the traces list: each session (calls sharing a group id)
 * collapses into ONE summary row, while ungrouped calls stay individual. The two
 * are merged and sorted by recency. Discriminated by `kind` ('session' | 'call').
 */
export async function listTraceFeed(limit = 100, meta?: MetaFilter | null) {
	// optional metadata predicate: exact key/value containment, or key existence
	const metaCond =
		meta == null
			? undefined
			: meta.value != null
				? sql`${requestTrace.metadata} @> ${JSON.stringify({ [meta.key]: meta.value })}::jsonb`
				: sql`jsonb_exists(${requestTrace.metadata}, ${meta.key})`;

	const sessions = await db
		.select({
			groupId: requestTrace.traceGroupId,
			calls: sql<number>`count(*)::int`,
			errorCount: sql<number>`count(*) filter (where ${auditLog.status} not in ('ok', 'allow'))::int`,
			at: sql<Date>`max(${requestTrace.createdAt})`,
			costUsd: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::int`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::int`,
			models: sql<string[]>`array_remove(array_agg(distinct ${auditLog.model}), null)`,
			serviceName: sql<string | null>`max(${service.name})`
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(and(isNotNull(requestTrace.traceGroupId), ...(metaCond ? [metaCond] : [])))
		.groupBy(requestTrace.traceGroupId)
		.orderBy(desc(sql`max(${requestTrace.createdAt})`))
		.limit(limit);

	const calls = await db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			format: requestTrace.responseFormat,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(and(isNull(requestTrace.traceGroupId), ...(metaCond ? [metaCond] : [])))
		.orderBy(desc(requestTrace.createdAt))
		.limit(limit);

	const feed = [
		...sessions.map((s) => ({ kind: 'session' as const, ...s })),
		...calls.map((c) => ({ kind: 'call' as const, at: c.createdAt, ...c }))
	];
	feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	return feed.slice(0, limit);
}

/**
 * The other traces sharing a caller-supplied group id, oldest first — the
 * session timeline shown on a trace's detail view. Metadata only (no payloads).
 */
export function listTraceGroup(groupId: string, limit = 100) {
	return db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.where(eq(requestTrace.traceGroupId, groupId))
		.orderBy(requestTrace.createdAt)
		.limit(limit);
}

/**
 * One summary row per ingested OTLP trace (newest first): the root span's name,
 * total span count, wall-clock duration, an error flag, and the service. Two
 * queries — aggregates grouped by trace id, then the earliest root span's name —
 * merged in code, since picking the root per group isn't a plain aggregate.
 */
export async function listOtelTraces(limit = 100) {
	const agg = await db
		.select({
			traceId: traceSpan.traceId,
			spanCount: sql<number>`count(*)::int`,
			errorCount: sql<number>`count(*) filter (where ${traceSpan.status} = 'error')::int`,
			startedAt: sql<Date>`min(${traceSpan.startedAt})`,
			// wall clock = latest span end − earliest span start, in ms
			durationMs: sql<number>`(extract(epoch from max(${traceSpan.startedAt})) * 1000 + max(${traceSpan.durationMs}) - extract(epoch from min(${traceSpan.startedAt})) * 1000)::int`,
			serviceName: sql<string | null>`max(${traceSpan.serviceName})`
		})
		.from(traceSpan)
		.groupBy(traceSpan.traceId)
		.orderBy(desc(sql`min(${traceSpan.startedAt})`))
		.limit(limit);

	if (agg.length === 0) return [];

	// earliest root (parent-less) span per trace → the trace's display name
	const ids = agg.map((a) => a.traceId);
	const roots = await db
		.select({ traceId: traceSpan.traceId, name: traceSpan.name, startedAt: traceSpan.startedAt })
		.from(traceSpan)
		.where(and(inArray(traceSpan.traceId, ids), isNull(traceSpan.parentSpanId)))
		.orderBy(traceSpan.startedAt);
	const rootName = new Map<string, string>();
	for (const r of roots) if (!rootName.has(r.traceId)) rootName.set(r.traceId, r.name);

	return agg.map((a) => ({ ...a, rootName: rootName.get(a.traceId) ?? '(trace)' }));
}

/** All spans of one ingested trace, oldest first, for the tree/waterfall view. */
export function getOtelTrace(traceId: string) {
	return db
		.select({
			spanId: traceSpan.spanId,
			parentSpanId: traceSpan.parentSpanId,
			name: traceSpan.name,
			kind: traceSpan.kind,
			status: traceSpan.status,
			startedAt: traceSpan.startedAt,
			durationMs: traceSpan.durationMs,
			serviceName: traceSpan.serviceName,
			attributes: traceSpan.attributes
		})
		.from(traceSpan)
		.where(eq(traceSpan.traceId, traceId))
		.orderBy(traceSpan.startedAt);
}

/**
 * Every call in a session (by group id), oldest first, WITH payloads — so the
 * full-session view can stitch the whole run's conversation onto one page.
 */
export function getTraceGroupDetail(groupId: string, limit = 200) {
	return db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			requestBody: requestTrace.requestBody,
			responseBody: requestTrace.responseBody,
			format: requestTrace.responseFormat,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			latencyMs: auditLog.latencyMs,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(eq(requestTrace.traceGroupId, groupId))
		.orderBy(requestTrace.createdAt)
		.limit(limit);
}

/** Load a single trace with its full request/response payloads and metadata. */
export async function getTrace(id: string) {
	const [row] = await db
		.select({
			id: requestTrace.id,
			createdAt: requestTrace.createdAt,
			requestBody: requestTrace.requestBody,
			responseBody: requestTrace.responseBody,
			format: requestTrace.responseFormat,
			groupId: requestTrace.traceGroupId,
			metadata: requestTrace.metadata,
			action: auditLog.action,
			status: auditLog.status,
			statusCode: auditLog.statusCode,
			provider: auditLog.provider,
			model: auditLog.model,
			costUsd: auditLog.costUsd,
			inputTokens: auditLog.inputTokens,
			outputTokens: auditLog.outputTokens,
			providerCachedTokens: auditLog.providerCachedTokens,
			cacheWriteTokens: auditLog.cacheWriteTokens,
			latencyMs: auditLog.latencyMs,
			ip: auditLog.ip,
			detail: auditLog.detail,
			serviceName: service.name
		})
		.from(requestTrace)
		.innerJoin(auditLog, eq(auditLog.id, requestTrace.auditLogId))
		.leftJoin(service, eq(service.id, requestTrace.serviceId))
		.where(eq(requestTrace.id, id))
		.limit(1);
	return row ?? null;
}
