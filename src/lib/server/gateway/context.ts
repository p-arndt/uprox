/** Per-request context, the audit writer and audited rejections. */
import type { RequestEvent } from '@sveltejs/kit';
import type { ResolvedToken } from '$lib/server/tokens';
import type { GatewayScope } from '$lib/scopes';
import { audit } from '$lib/server/audit';
import type { ErrorEnvelope } from './envelope';
import type { GatewayAuth } from './authenticate';

/** Everything the shared pipeline steps need to know about one gateway request. */
export interface RequestContext {
	event: RequestEvent;
	token: ResolvedToken;
	ip: string;
	started: number;
	scope: GatewayScope;
	model: string;
	envelope: ErrorEnvelope;
	audit: typeof audit;
}

export function createContext(
	event: RequestEvent,
	auth: GatewayAuth,
	init: { scope: GatewayScope; model: string; envelope: ErrorEnvelope }
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
		audit
	};
}

interface RejectionAudit {
	/** provider id to record; omitted when routing failed before one was known */
	provider?: string | null;
	statusCode: number;
	detail: string;
	/** a policy decision (status `deny`) rather than a gateway error */
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
	await ctx.audit({
		// denials stay under gateway.*: usage, budget and audit queries count
		// gateway traffic by that prefix and tell denials apart by status
		action: `gateway.${ctx.scope}`,
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
