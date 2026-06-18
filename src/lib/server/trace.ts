import { eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { requestTrace, settings, traceSpan } from '$lib/server/db/schema';
import type { ParsedSpan } from '$lib/server/otlp/decode';

/** A captured request/response pair, linked to its audit row. */
export interface TraceInput {
	/** the audit row this trace augments (from {@link audit}'s return value) */
	auditLogId: string;
	serviceId?: string | null;
	/** caller-supplied session/correlation id grouping related calls (header) */
	groupId?: string | null;
	/** request body as received; JSON-stringified here. Undefined/null → stored null. */
	request?: unknown;
	/** response body returned to the client (buffered JSON or reassembled SSE text) */
	response?: string | null;
	/** how to render the response: "json" (buffered) or "sse" (streamed) */
	format?: 'json' | 'sse' | null;
}

/** Cap a stored payload so a pathological prompt/response can't bloat a row. */
const MAX_PAYLOAD_CHARS = 256 * 1024;

function clamp(s: string | null): string | null {
	if (s == null) return null;
	return s.length > MAX_PAYLOAD_CHARS ? s.slice(0, MAX_PAYLOAD_CHARS) + '\n…[truncated]' : s;
}

function stringifyRequest(request: unknown): string | null {
	if (request == null) return null;
	if (typeof request === 'string') return clamp(request);
	try {
		return clamp(JSON.stringify(request));
	} catch {
		return null;
	}
}

/**
 * Persist a request trace for the in-app trace viewer. Best-effort and never
 * throws — like {@link audit}, tracing must not break the request it records.
 * Call only when tracing is enabled for the request (the gateway resolves that
 * from the instance setting and the policy override before calling).
 */
export async function recordTrace(input: TraceInput): Promise<void> {
	try {
		await db.insert(requestTrace).values({
			auditLogId: input.auditLogId,
			serviceId: input.serviceId ?? null,
			traceGroupId: input.groupId ?? null,
			requestBody: stringifyRequest(input.request),
			responseBody: clamp(input.response ?? null),
			responseFormat: input.response != null ? (input.format ?? 'json') : null
		});
		void pruneTracesIfDue();
	} catch (err) {
		console.error('[trace] failed to record trace', err);
	}
}

/** Bound any single attribute string so a giant prompt/response can't bloat a row. */
function clampAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(attrs)) {
		out[k] =
			typeof v === 'string' && v.length > MAX_PAYLOAD_CHARS
				? v.slice(0, MAX_PAYLOAD_CHARS) + '…[truncated]'
				: v;
	}
	return out;
}

/**
 * Persist OTLP spans ingested from a client app (see /v1/traces). Best-effort,
 * never throws. Dedupes on (traceId, spanId) so a resend is idempotent. Returns
 * how many rows were offered for insert.
 */
export async function recordSpans(spans: ParsedSpan[], serviceId: string | null): Promise<number> {
	const rows = spans
		.filter((s) => s.traceId && s.spanId)
		.map((s) => ({
			traceId: s.traceId,
			spanId: s.spanId,
			parentSpanId: s.parentSpanId,
			name: s.name || '(unnamed)',
			kind: s.kind,
			startedAt: s.startedAt,
			durationMs: Number.isFinite(s.durationMs) ? Math.max(0, Math.round(s.durationMs)) : 0,
			status: s.status,
			serviceName: s.serviceName,
			serviceId,
			attributes: clampAttributes(s.attributes)
		}));
	if (!rows.length) return 0;
	try {
		await db.insert(traceSpan).values(rows).onConflictDoNothing();
		void pruneTracesIfDue();
		return rows.length;
	} catch (err) {
		console.error('[trace] failed to record spans', err);
		return 0;
	}
}

// Module-level throttle: the app is a single process with no scheduler, so we
// sweep expired traces opportunistically (at most once an hour) off the back of
// a write rather than on every request.
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Delete traces older than the instance's retention window, at most once an
 * hour. Throttled in-memory and best-effort; resets on restart, which is fine —
 * the next write reschedules it.
 */
export async function pruneTracesIfDue(): Promise<void> {
	const now = Date.now();
	if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
	lastPruneAt = now;
	try {
		const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
		const days = row?.tracingRetentionDays ?? 30;
		if (days <= 0) return;
		const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
		await db.delete(requestTrace).where(lt(requestTrace.createdAt, cutoff));
		await db.delete(traceSpan).where(lt(traceSpan.createdAt, cutoff));
	} catch (err) {
		console.error('[trace] failed to prune traces', err);
	}
}
