/** Per-request context, the audit+trace writer and audited rejections. */
import type { RequestEvent } from '@sveltejs/kit';
import type { ResolvedToken } from '$lib/server/tokens';
import type { GatewayScope } from '$lib/scopes';
import { audit, type AuditEntry } from '$lib/server/audit';
import { recordTrace } from '$lib/server/trace';
import type { ErrorEnvelope } from './envelope';
import { readTraceGroup, readTraceMetadata, type GatewayAuth } from './authenticate';

/** Response payload attached to a request trace. */
export interface TraceResponse {
	response?: string | null;
	format?: 'json' | 'sse';
}

/** Writes an audit row and, when tracing is on, the paired request trace. */
export type AuditTrace = (entry: AuditEntry, resp?: TraceResponse) => Promise<void>;

export interface AuditTraceOptions {
	serviceId: string;
	/** request tracing switch resolved from the effective config */
	tracingEnabled: boolean;
	groupId: string | null;
	metadata: Record<string, unknown> | null;
	/** the request payload stored on the trace (the body, or a summary of it) */
	request: unknown;
}

/**
 * Build the audit+trace writer for one request. Every audit row is written; when
 * tracing is enabled (policy override wins over the instance default) the row is
 * paired with a request trace — the prompt plus, on the paths that produced one,
 * the response payload — for the in-app trace viewer.
 */
export function makeAuditTrace(
	opts: AuditTraceOptions,
	deps: { audit: typeof audit; recordTrace: typeof recordTrace } = { audit, recordTrace }
): AuditTrace {
	return async (entry, resp) => {
		const auditLogId = await deps.audit(entry);
		if (opts.tracingEnabled && auditLogId) {
			await deps.recordTrace({
				auditLogId,
				serviceId: opts.serviceId,
				groupId: opts.groupId,
				metadata: opts.metadata,
				request: opts.request,
				response: resp?.response ?? null,
				format: resp?.format ?? null
			});
		}
	};
}

/** Everything the shared pipeline steps need to know about one gateway request. */
export interface RequestContext {
	event: RequestEvent;
	token: ResolvedToken;
	ip: string;
	started: number;
	scope: GatewayScope;
	model: string;
	envelope: ErrorEnvelope;
	auditTrace: AuditTrace;
}

export function createContext(
	event: RequestEvent,
	auth: GatewayAuth,
	init: { scope: GatewayScope; model: string; envelope: ErrorEnvelope; traceRequest: unknown }
): RequestContext {
	const { token, ip } = auth;
	return {
		event,
		token,
		ip,
		started: Date.now(),
		scope: init.scope,
		model: init.model,
		envelope: init.envelope,
		auditTrace: makeAuditTrace({
			serviceId: token.serviceId,
			tracingEnabled: token.effective.tracingEnabled,
			groupId: readTraceGroup(event),
			metadata: readTraceMetadata(event),
			request: init.traceRequest
		})
	};
}

interface RejectionAudit {
	/** provider id to record; omitted when routing failed before one was known */
	provider?: string | null;
	statusCode: number;
	detail: string;
	/** a policy decision (`policy.deny`) rather than a gateway error */
	deny?: boolean;
	/** record latency (for failures after work started, e.g. the upstream call) */
	timed?: boolean;
}

/** Audit a request the gateway rejected and hand back the client response. */
export async function reject(
	ctx: RequestContext,
	info: RejectionAudit,
	response: Response
): Promise<Response> {
	await ctx.auditTrace({
		action: info.deny ? 'policy.deny' : `gateway.${ctx.scope}`,
		status: info.deny ? 'deny' : 'error',
		serviceId: ctx.token.serviceId,
		tokenId: ctx.token.tokenId,
		provider: info.provider,
		model: ctx.model,
		statusCode: info.statusCode,
		...(info.timed ? { latencyMs: Date.now() - ctx.started } : {}),
		ip: ctx.ip,
		detail: info.detail
	});
	return response;
}
