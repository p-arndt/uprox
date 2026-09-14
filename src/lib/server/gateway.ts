import { json, type RequestEvent, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { providerSecret } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { resolveToken, type ResolvedToken } from '$lib/server/tokens';
import { evaluatePolicy } from '$lib/server/policy';
import {
	providerForModel,
	resolveProvider,
	providerSupports,
	resolveBaseUrl,
	authHeaders,
	selectProviderSecret,
	PROVIDERS,
	type Capability,
	type ProviderDef
} from '$lib/server/providers';
import { getAdapter } from '$lib/server/adapters';
import { mapUsage } from '$lib/server/adapters/gemini';
import { normalizeUsage, type NormalizedUsage } from '$lib/server/usage';
import { audit, type AuditEntry } from '$lib/server/audit';
import { recordTrace } from '$lib/server/trace';
import { parseTraceparent, parseTraceMetadata } from '$lib/trace';
import { checkRateLimit } from '$lib/server/ratelimit';
import { checkBudget, reserve } from '$lib/server/budget';
import { maybeSendBudgetAlert, maybeSendInstanceBudgetAlert } from '$lib/server/budget-alerts';
import { cacheKeyFor, getCached, putCached, isDeterministicRequest } from '$lib/server/cache';
import { estimateCost, type CostEstimate } from '$lib/server/pricing';
import { isRecord } from '$lib/server/json';

/* ------------------------------------------------------------------------- */
/* Error envelopes                                                           */
/* ------------------------------------------------------------------------- */

/** OpenAI-style error envelope, so OpenAI SDK clients parse it correctly. */
export function gatewayError(status: number, message: string, type = 'invalid_request_error') {
	return json({ error: { message, type, code: null, param: null } }, { status });
}

/**
 * Native-Gemini error envelope (`{ error: { code, message, status } }`), so the
 * Google GenAI SDK — which expects native errors, not OpenAI ones — parses a
 * gateway rejection correctly.
 */
function geminiNativeError(status: number, message: string, googleStatus: string): Response {
	return json({ error: { code: status, message, status: googleStatus } }, { status });
}

/** Why the gateway rejected a request, independent of the wire envelope. */
export type ErrorKind =
	| 'invalid_request'
	| 'model_not_found'
	| 'permission'
	| 'insufficient_quota'
	| 'rate_limit'
	| 'upstream_misconfigured'
	| 'upstream_unavailable';

const OPENAI_ERROR_TYPES: Record<ErrorKind, string> = {
	invalid_request: 'invalid_request_error',
	model_not_found: 'model_not_found',
	permission: 'permission_error',
	insufficient_quota: 'insufficient_quota',
	rate_limit: 'rate_limit_error',
	upstream_misconfigured: 'api_error',
	upstream_unavailable: 'api_error'
};

const GOOGLE_ERROR_STATUSES: Record<ErrorKind, string> = {
	invalid_request: 'INVALID_ARGUMENT',
	model_not_found: 'INVALID_ARGUMENT',
	permission: 'PERMISSION_DENIED',
	insufficient_quota: 'RESOURCE_EXHAUSTED',
	rate_limit: 'RESOURCE_EXHAUSTED',
	upstream_misconfigured: 'FAILED_PRECONDITION',
	upstream_unavailable: 'UNAVAILABLE'
};

/**
 * Builds client-facing error responses in one ingress family's wire shape, so
 * the shared pipeline steps can reject a request without knowing whether the
 * caller is an OpenAI SDK or the Google GenAI SDK.
 */
export interface ErrorEnvelope {
	error(status: number, message: string, kind: ErrorKind): Response;
	/** 429 with a `retry-after` header (seconds, at least 1) */
	rateLimited(limit: number | undefined, retryAfterSeconds: number | undefined): Response;
}

function makeEnvelope(
	build: (status: number, message: string, kind: ErrorKind) => Response
): ErrorEnvelope {
	return {
		error: build,
		rateLimited(limit, retryAfterSeconds) {
			const res = build(429, `Rate limit exceeded: ${limit} requests/min`, 'rate_limit');
			res.headers.set('retry-after', String(retryAfterSeconds ?? 1));
			return res;
		}
	};
}

export const openAiEnvelope: ErrorEnvelope = makeEnvelope((status, message, kind) =>
	gatewayError(status, message, OPENAI_ERROR_TYPES[kind])
);

export const geminiEnvelope: ErrorEnvelope = makeEnvelope((status, message, kind) =>
	geminiNativeError(status, message, GOOGLE_ERROR_STATUSES[kind])
);

/* ------------------------------------------------------------------------- */
/* Usage extraction                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Normalize usage from a *native* Gemini response (buffered or a streamed
 * chunk). `mapUsage` converts Gemini's `usageMetadata` into the OpenAI usage
 * shape, which `normalizeUsage` then folds into the gateway's common figure — so
 * native-ingress requests are costed by the exact same code as everything else.
 */
function geminiNativeUsage(parsed: unknown): NormalizedUsage | null {
	if (!isRecord(parsed)) return null;
	const usageObj = mapUsage(parsed.usageMetadata);
	return usageObj ? normalizeUsage(usageObj) : null;
}

/**
 * Pull a usage figure out of one decoded JSON payload (a buffered response or a
 * streamed SSE chunk), or null if it carries none.
 */
type UsageExtractor = (obj: Record<string, unknown>) => NormalizedUsage | null;

/**
 * The OpenAI stream extractor reads the chat shape (`{ usage }`) and the
 * Responses shape (`{ response: { usage } }`).
 */
const openAiUsageExtractor: UsageExtractor = (obj) => {
	const u =
		(isRecord(obj.usage) && obj.usage) ||
		(isRecord(obj.response) && isRecord(obj.response.usage) && obj.response.usage);
	return u ? normalizeUsage(u) : null;
};

/** Buffered OpenAI-shaped responses carry usage at the top level only. */
const bufferedOpenAiUsageExtractor: UsageExtractor = (obj) => normalizeUsage(obj.usage);

/** The native Gemini extractor reads `{ usageMetadata }`. */
const geminiUsageExtractor: UsageExtractor = (obj) =>
	isRecord(obj.usageMetadata) ? geminiNativeUsage(obj) : null;

/** Usage from a buffered response body; null for non-JSON bodies or no usage. */
function usageFromText(text: string, extract: UsageExtractor): NormalizedUsage | null {
	try {
		const parsed: unknown = JSON.parse(text);
		return isRecord(parsed) ? extract(parsed) : null;
	} catch {
		return null;
	}
}

interface DrainedSse {
	usage: NormalizedUsage | null;
	/** the verbatim SSE body, reassembled — used to cache a streamed response */
	raw: string;
	/** false if the stream errored/aborted before completing (don't cache) */
	complete: boolean;
}

/**
 * Drain an SSE response stream: capture the last token usage it reports (via the
 * supplied extractor) and accumulate the raw body so a streamed response can be
 * cached and replayed verbatim.
 */
async function drainSse(
	stream: ReadableStream<Uint8Array>,
	extract: UsageExtractor
): Promise<DrainedSse> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let raw = '';
	let usage: NormalizedUsage | null = null;
	let complete = false;

	const take = (line: string) => {
		const data = line.slice(5).trim(); // strip "data:"
		if (!data || data === '[DONE]') return;
		try {
			const obj = JSON.parse(data) as Record<string, unknown>;
			const norm = extract(obj);
			if (norm) usage = norm;
		} catch {
			// ignore non-JSON keepalive/comment lines
		}
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			raw += chunk;
			buffer += chunk;
			let nl: number;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (line.startsWith('data:')) take(line);
			}
		}
		if (buffer.startsWith('data:')) take(buffer);
		complete = true;
	} catch {
		// stream aborted; return whatever we saw and mark it incomplete
	} finally {
		reader.releaseLock();
	}
	return { usage, raw, complete };
}

/* ------------------------------------------------------------------------- */
/* Request headers and authentication                                        */
/* ------------------------------------------------------------------------- */

/**
 * Read the caller's machine token. Accepts
 *   `Authorization: Bearer <token>` (OpenAI SDK shape),
 *   `api-key: <token>` (Azure OpenAI SDK shape), or
 *   `x-goog-api-key: <token>` (Google GenAI SDK shape, used by native ingress),
 * so the same uprox instance can sit behind clients of all three ecosystems.
 */
function readApiKey(event: RequestEvent): string | null {
	const header = event.request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	if (match) return match[1].trim();
	const apiKey = event.request.headers.get('api-key')?.trim();
	if (apiKey) return apiKey;
	const goog = event.request.headers.get('x-goog-api-key')?.trim();
	return goog ? goog : null;
}

/**
 * Read the caller's session/correlation id for trace grouping. Lets the several
 * gateway calls of one logical run — e.g. a tool-use loop — collapse into a
 * single timeline in the trace viewer.
 *
 * Resolution order, so grouping needs *no* client changes in the common case:
 *   1. `x-uprox-trace-id` / `x-uprox-session-id` — explicit opt-in / override.
 *   2. W3C `traceparent` — every OpenTelemetry-instrumented client already sends
 *      this; we extract its 32-hex trace-id. This is also the id uprox shares
 *      with the app's own OTLP spans, so the two stitch into one trace.
 * Returns null when none is present (the call is traced, just not grouped).
 */
function readTraceGroup(event: RequestEvent): string | null {
	const explicit =
		event.request.headers.get('x-uprox-trace-id') ??
		event.request.headers.get('x-uprox-session-id');
	const trimmed = explicit?.trim();
	if (trimmed) return trimmed.slice(0, 200);

	return parseTraceparent(event.request.headers.get('traceparent'));
}

/**
 * Read caller-supplied trace metadata — free-form key/values attached to the
 * trace (the OpenInference `metadata` equivalent): a chat id, end-user id,
 * tenant, experiment, tags, anything. Two sources, merged:
 *   - `x-uprox-metadata`: a JSON object header (richest; nested values allowed).
 *   - `x-uprox-meta-<key>: <value>`: one header per key (string values).
 * Returns null when nothing was sent. Deliberately generic — uprox never
 * special-cases particular keys.
 */
function readTraceMetadata(event: RequestEvent): Record<string, unknown> | null {
	return parseTraceMetadata(event.request.headers.get('x-uprox-metadata'), event.request.headers);
}

export interface GatewayAuth {
	token: ResolvedToken;
	ip: string;
}

/**
 * Authenticate a gateway request via its machine token. Returns either the
 * resolved token context or a ready-to-return error Response.
 */
export async function authenticateGateway(
	event: RequestEvent
): Promise<{ ok: true; auth: GatewayAuth } | { ok: false; response: Response }> {
	const raw = readApiKey(event);
	if (!raw) {
		return { ok: false, response: gatewayError(401, 'Missing API key', 'authentication_error') };
	}
	const token = await resolveToken(raw);
	if (!token) {
		return {
			ok: false,
			response: gatewayError(401, 'Invalid or revoked API key', 'authentication_error')
		};
	}
	return { ok: true, auth: { token, ip: event.getClientAddress() } };
}

/* ------------------------------------------------------------------------- */
/* Credentials                                                               */
/* ------------------------------------------------------------------------- */

interface ProviderCreds {
	apiKey: string;
	/** endpoint override (Azure), null when the static baseUrl applies */
	baseUrl: string | null;
}

/**
 * Load the credentials to use for a provider. A provider may hold several
 * secrets (e.g. multiple Azure OpenAI resources); `preferSecretId` is the
 * calling service's pinned secret, honoured when it belongs to this provider,
 * otherwise the provider's highest-priority secret is used. See
 * selectProviderSecret.
 */
async function loadProviderCreds(
	provider: string,
	preferSecretId?: string | null
): Promise<ProviderCreds | null> {
	const rows = await db.select().from(providerSecret).where(eq(providerSecret.provider, provider));
	const picked = selectProviderSecret(rows, provider, preferSecretId);
	if (!picked) return null;
	return { apiKey: decrypt(picked.encryptedSecret), baseUrl: picked.baseUrl };
}

/** Distinct provider ids the instance has at least one secret configured for. */
async function loadConfiguredProviders(): Promise<string[]> {
	const rows = await db.selectDistinct({ provider: providerSecret.provider }).from(providerSecret);
	return rows.map((r) => r.provider);
}

export { loadProviderCreds };

/* ------------------------------------------------------------------------- */
/* Request context and audit trace                                           */
/* ------------------------------------------------------------------------- */

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
interface RequestContext {
	event: RequestEvent;
	token: ResolvedToken;
	ip: string;
	started: number;
	scope: Capability;
	model: string;
	envelope: ErrorEnvelope;
	auditTrace: AuditTrace;
}

function createContext(
	event: RequestEvent,
	auth: GatewayAuth,
	init: { scope: Capability; model: string; envelope: ErrorEnvelope; traceRequest: unknown }
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
async function reject(
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

/* ------------------------------------------------------------------------- */
/* Guards                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Route by model, choosing among the providers this instance has configured.
 * OpenAI and Azure share the model namespace; an explicit `preferProvider` (set
 * by Azure-style URL routes to signal URL-level intent) wins, otherwise the
 * policy's preferredProvider breaks the tie. See resolveProvider.
 */
async function resolveRoutedProvider(
	ctx: RequestContext,
	preferProvider: string | undefined
): Promise<ProviderDef | Response> {
	const configuredProviders = await loadConfiguredProviders();
	const provider = resolveProvider(
		ctx.model,
		configuredProviders,
		preferProvider ?? ctx.token.effective.preferredProvider
	);
	if (provider) return provider;

	// Distinguish "we don't recognize this model" from "we recognize it but the
	// instance hasn't configured the provider that would serve it".
	const known = providerForModel(ctx.model);
	if (known) {
		return reject(
			ctx,
			{ provider: known.id, statusCode: 502, detail: `no ${known.id} secret configured` },
			ctx.envelope.error(
				502,
				`No ${known.label} credentials configured for this instance`,
				'upstream_misconfigured'
			)
		);
	}
	return reject(
		ctx,
		{ statusCode: 400, detail: `unknown model "${ctx.model}"` },
		ctx.envelope.error(400, `Unknown or unsupported model: ${ctx.model}`, 'model_not_found')
	);
}

/**
 * Capability, policy and rate-limit checks shared by every model-routed
 * pipeline. Returns the (already audited) rejection, or null to continue.
 */
async function checkAccess(ctx: RequestContext, provider: ProviderDef): Promise<Response | null> {
	const { token, scope, model } = ctx;

	// not every provider implements every endpoint (e.g. the Responses API and
	// embeddings are OpenAI-only)
	if (!providerSupports(provider, scope)) {
		return reject(
			ctx,
			{
				provider: provider.id,
				statusCode: 400,
				detail: `${provider.id} does not support ${scope}`
			},
			ctx.envelope.error(
				400,
				`${provider.label} does not support ${scope} requests (model "${model}")`,
				'model_not_found'
			)
		);
	}

	const decision = evaluatePolicy(token, { provider: provider.id, model, scope });
	if (!decision.allow) {
		return reject(
			ctx,
			{ provider: provider.id, statusCode: 403, detail: decision.reason, deny: true },
			ctx.envelope.error(403, `Request denied by policy: ${decision.reason}`, 'permission')
		);
	}

	// rate limiting (in-memory, per token) — protects the gateway and upstream
	// from runaway callers before we do any I/O.
	const rl = checkRateLimit(token.tokenId, token.effective.rateLimitPerMinute);
	if (!rl.ok) {
		return reject(
			ctx,
			{
				provider: provider.id,
				statusCode: 429,
				detail: `rate limit exceeded (${rl.limit}/min)`,
				deny: true
			},
			ctx.envelope.rateLimited(rl.limit, rl.retryAfter)
		);
	}
	return null;
}

/**
 * Replay a cached response when the exact-match cache has one. A hit is free —
 * no key, no upstream call, no spend — so this runs before the budget gate.
 */
async function replayCached(
	ctx: RequestContext,
	provider: ProviderDef,
	cacheKey: string,
	stream: boolean,
	detailPrefix = ''
): Promise<Response | null> {
	const hit = await getCached(cacheKey);
	if (!hit) return null;
	await ctx.auditTrace(
		{
			action: `gateway.${ctx.scope}`,
			status: 'ok',
			serviceId: ctx.token.serviceId,
			tokenId: ctx.token.tokenId,
			provider: provider.id,
			model: ctx.model,
			statusCode: hit.statusCode,
			costUsd: 0,
			// exact savings: what this request would have cost upstream
			savedUsd: hit.costUsd,
			// tokens the miss consumed — replayed here as "saved" so analytics can
			// show cache impact without double-counting consumption.
			savedInputTokens: hit.inputTokens,
			savedOutputTokens: hit.outputTokens,
			latencyMs: Date.now() - ctx.started,
			ip: ctx.ip,
			detail: `${detailPrefix}cache hit${stream ? ' (stream)' : ''}`
		},
		{ response: hit.response, format: stream ? 'sse' : 'json' }
	);
	return new Response(hit.response, {
		status: hit.statusCode,
		headers: stream
			? { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-uprox-cache': 'HIT' }
			: { 'content-type': 'application/json', 'x-uprox-cache': 'HIT' }
	});
}

/**
 * Enforce the three budget scopes that apply to a request: the instance-wide
 * ceiling, the service's aggregate ceiling, and the token's personal cap. All
 * are checked; a request must pass each budget that is set. On denial returns
 * the 402 Response (already audited); otherwise returns a single release handle
 * that frees every reservation it took (a no-op when no budget applies). See
 * budget.ts for the bucket model.
 */
async function enforceBudgets(
	ctx: RequestContext,
	provider: ProviderDef
): Promise<Response | (() => void)> {
	const { token } = ctx;
	const { serviceBudget, tokenBudget, instanceBudget } = token.effective;
	const buckets = [
		// the instance ceiling shares one bucket across all traffic — a fixed id
		{ scope: 'instance' as const, id: 'instance', limits: instanceBudget },
		{ scope: 'service' as const, id: token.serviceId, limits: serviceBudget },
		{ scope: 'token' as const, id: token.tokenId, limits: tokenBudget }
	].filter((b) => b.limits.dailyBudgetUsd > 0 || b.limits.monthlyBudgetUsd > 0);

	// Soft-alert evaluation (emails admins once per window/level), per budget
	// scope. Runs on allow and deny alike. Never blocks the request.
	if (serviceBudget.dailyBudgetUsd > 0 || serviceBudget.monthlyBudgetUsd > 0) {
		void maybeSendBudgetAlert(token.serviceId, token.serviceName, serviceBudget);
	}
	if (instanceBudget.dailyBudgetUsd > 0 || instanceBudget.monthlyBudgetUsd > 0) {
		void maybeSendInstanceBudgetAlert(instanceBudget);
	}

	for (const b of buckets) {
		const budget = await checkBudget(b.scope, b.id, b.limits);
		if (!budget.ok) {
			return reject(
				ctx,
				{ provider: provider.id, statusCode: 402, detail: budget.reason, deny: true },
				ctx.envelope.error(402, `Request denied: ${budget.reason}`, 'insufficient_quota')
			);
		}
	}

	// Reserve only after all checks pass, so a denied request leaves no residue.
	const releases = buckets.map((b) => reserve(b.scope, b.id));
	return () => releases.forEach((r) => r());
}

/** What a request needs to reach its upstream once every guard has passed. */
interface UpstreamGrant {
	apiKey: string;
	baseUrl: string;
	/** frees the in-flight budget reservation; call exactly once */
	release: () => void;
}

/**
 * Budget gate, then credentials and base URL. The budget reservation covers the
 * in-flight gap (a request's cost lands in the audit log only on completion); it
 * is released here on failure and by the recorder once the cost is recorded.
 */
async function acquireUpstream(
	ctx: RequestContext,
	provider: ProviderDef
): Promise<UpstreamGrant | Response> {
	const budgetGate = await enforceBudgets(ctx, provider);
	if (budgetGate instanceof Response) return budgetGate;
	const release = budgetGate;

	// honour the service's pinned secret (e.g. a specific Azure resource) when it
	// belongs to the resolved provider
	const creds = await loadProviderCreds(provider.id, ctx.token.providerSecretId);
	if (!creds) {
		release();
		return reject(
			ctx,
			{ provider: provider.id, statusCode: 502, detail: `no ${provider.id} secret configured` },
			ctx.envelope.error(
				502,
				`No ${provider.label} credentials configured for this instance`,
				'upstream_misconfigured'
			)
		);
	}

	// for Azure this is the instance's configured resource endpoint; a
	// misconfigured endpoint-based provider can't be reached
	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		release();
		return reject(
			ctx,
			{ provider: provider.id, statusCode: 502, detail: `no ${provider.id} endpoint configured` },
			ctx.envelope.error(
				502,
				`No ${provider.label} endpoint configured for this instance`,
				'upstream_misconfigured'
			)
		);
	}
	return { apiKey: creds.apiKey, baseUrl, release };
}

/* ------------------------------------------------------------------------- */
/* Upstream call and usage recording                                         */
/* ------------------------------------------------------------------------- */

/**
 * Call the upstream. A network failure releases the reservation, is audited and
 * comes back as a 502 in the caller's envelope.
 */
async function fetchUpstream(
	ctx: RequestContext,
	provider: ProviderDef,
	grant: UpstreamGrant,
	url: string,
	init: RequestInit
): Promise<{ ok: true; upstream: Response } | { ok: false; response: Response }> {
	try {
		return { ok: true, upstream: await fetch(url, init) };
	} catch (err) {
		grant.release();
		const response = await reject(
			ctx,
			{
				provider: provider.id,
				statusCode: 502,
				detail: err instanceof Error ? err.message : 'upstream fetch failed',
				timed: true
			},
			ctx.envelope.error(502, 'Upstream provider request failed', 'upstream_unavailable')
		);
		return { ok: false, response };
	}
}

/** Where a cacheable response is stored. */
interface CacheTarget {
	key: string;
	ttlSeconds: number;
}

interface CompletionRecord {
	provider: ProviderDef;
	statusCode: number;
	ok: boolean;
	usage: NormalizedUsage | null;
	/** response payload for the trace and the cache */
	response: string;
	format?: 'json' | 'sse';
	detail?: string;
	/** null when the request isn't cacheable */
	cache: CacheTarget | null;
	/** false for a truncated stream, which must never be cached */
	complete: boolean;
	/** frees the in-flight budget reservation */
	release: () => void;
}

/** Cost a usage figure; a pricing failure records a null cost instead of throwing. */
async function costOf(model: string, usage: NormalizedUsage | null): Promise<CostEstimate> {
	if (!usage) return { costUsd: null, tier: null };
	try {
		return await estimateCost(
			model,
			usage.input ?? undefined,
			usage.output ?? undefined,
			usage.cacheRead ?? 0,
			usage.cacheWrite ?? 0
		);
	} catch (err) {
		console.error('[gateway] cost estimation failed', err);
		return { costUsd: null, tier: null };
	}
}

/**
 * The single usage -> cost -> audit (+ trace) -> cache recorder shared by every
 * pipeline, buffered and streamed. Always releases the budget reservation once
 * the real cost is in the audit log, and populates the cache on a clean success.
 */
async function recordCompletion(ctx: RequestContext, r: CompletionRecord): Promise<void> {
	const { usage } = r;
	try {
		const { costUsd, tier } = await costOf(ctx.model, usage);
		await ctx.auditTrace(
			{
				action: `gateway.${ctx.scope}`,
				status: r.ok ? 'ok' : 'error',
				serviceId: ctx.token.serviceId,
				tokenId: ctx.token.tokenId,
				provider: r.provider.id,
				model: ctx.model,
				statusCode: r.statusCode,
				costUsd,
				inputTokens: usage?.input ?? null,
				outputTokens: usage?.output ?? null,
				providerCachedTokens: usage?.cacheRead ?? null,
				cacheWriteTokens: usage?.cacheWrite ?? null,
				contextTier: tier,
				latencyMs: Date.now() - ctx.started,
				ip: ctx.ip,
				...(r.detail ? { detail: r.detail } : {})
			},
			{ response: r.response, format: r.format }
		);
		if (r.cache && r.ok && r.complete && r.response) {
			await putCached({
				cacheKey: r.cache.key,
				provider: r.provider.id,
				model: ctx.model,
				statusCode: r.statusCode,
				response: r.response,
				costUsd,
				inputTokens: usage?.input ?? null,
				outputTokens: usage?.output ?? null,
				ttlSeconds: r.cache.ttlSeconds
			});
		}
	} finally {
		r.release();
	}
}

interface StreamRecording {
	provider: ProviderDef;
	upstream: Response;
	source: ReadableStream<Uint8Array>;
	extract: UsageExtractor;
	cache: CacheTarget | null;
	detail: string;
	release: () => void;
}

/**
 * Hand a streamed response to the client while its usage is recorded in the
 * background once the stream finishes.
 */
function streamWithRecording(ctx: RequestContext, s: StreamRecording): Response {
	const [clientBranch, costBranch] = s.source.tee();
	void (async () => {
		const { usage, raw, complete } = await drainSse(costBranch, s.extract);
		await recordCompletion(ctx, {
			provider: s.provider,
			statusCode: s.upstream.status,
			ok: true,
			usage,
			response: raw,
			format: 'sse',
			detail: s.detail,
			cache: s.cache,
			complete,
			release: s.release
		});
	})();
	return new Response(clientBranch, {
		status: s.upstream.status,
		headers: {
			'content-type': s.upstream.headers.get('content-type') ?? 'text/event-stream',
			'cache-control': 'no-cache',
			...(s.cache ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}

/* ------------------------------------------------------------------------- */
/* OpenAI-compatible JSON pipeline                                           */
/* ------------------------------------------------------------------------- */

export interface ProxyOptions {
	auth: GatewayAuth;
	/** the gateway capability this request exercises (also the policy scope) */
	scope: Capability;
	model: string;
	/** upstream path appended to the provider base url, e.g. "/chat/completions" */
	path: string;
	body: unknown;
	stream: boolean;
	/**
	 * Ask a pass-through upstream to append a usage chunk to a streamed response
	 * (`stream_options.include_usage`), so streamed chat completions can be
	 * costed. Set by the chat-completions endpoint descriptor.
	 */
	wantsUsageChunk?: boolean;
	/**
	 * Override the provider routed to when both OpenAI and Azure are configured.
	 * Set from Azure-style URL routes (`/openai/deployments/…`, `/openai/v1/…`)
	 * so URL-level intent beats the policy's preferredProvider. Optional.
	 */
	preferProvider?: string;
}

/**
 * The core request flow: route by model → enforce policy → load the upstream
 * key → proxy to the provider → audit. Returns a Response either way.
 */
export async function proxyToProvider(event: RequestEvent, opts: ProxyOptions): Promise<Response> {
	const { auth, scope, model, path, body, stream, preferProvider, wantsUsageChunk } = opts;
	const ctx = createContext(event, auth, {
		scope,
		model,
		envelope: openAiEnvelope,
		traceRequest: body
	});
	const { token } = ctx;

	const provider = await resolveRoutedProvider(ctx, preferProvider);
	if (provider instanceof Response) return provider;

	const denied = await checkAccess(ctx, provider);
	if (denied) return denied;

	// exact-match cache: applies to chat, embeddings, and the Responses API.
	// Streaming responses are cacheable too: the SSE body is captured and replayed
	// verbatim on a hit. The cache key includes the request's `stream` flag, so a
	// streamed request only ever matches a stored SSE body and a buffered request
	// only matches stored JSON — formats never cross.
	// Caching is an instance-wide optimization, not access control: it applies even
	// to services with no policy. A policy's cacheTtlSeconds, when set (non-null),
	// overrides the instance default — including 0 to explicitly opt a policy out.
	// Note on the Responses API: a multi-turn call carries `previous_response_id`,
	// which differs every turn, so its body never collides with another turn —
	// only a byte-identical request is ever served from cache.
	const cacheTtl = token.effective.cacheTtlSeconds;
	// A Responses API call with store:false isn't persisted by OpenAI, so its
	// returned `id` can't be referenced later — don't cache/replay one.
	const responsesStoreOff = scope === 'responses' && isRecord(body) && body.store === false;
	const cacheable =
		(scope === 'chat' || scope === 'embeddings' || scope === 'responses') &&
		cacheTtl > 0 &&
		!responsesStoreOff &&
		// only cache reproducible requests: embeddings always, chat/responses only
		// when sampling is pinned (temperature 0 or an explicit seed), so two
		// identical-but-varied prompts each reach the model.
		isDeterministicRequest(scope, body);
	const cache: CacheTarget | null = cacheable
		? { key: cacheKeyFor(provider.id, path, body, token.providerSecretId), ttlSeconds: cacheTtl }
		: null;
	if (cache) {
		const hit = await replayCached(ctx, provider, cache.key, stream);
		if (hit) return hit;
	}

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	// A provider with an adapter speaks a non-OpenAI native API; it builds its own
	// URL and translates the request/response bodies. Pass-through providers send
	// the OpenAI request verbatim to `${baseUrl}${path}`.
	const adapter = getAdapter(provider.id);

	let outboundBody = body;
	// For streamed chat completions, ask the upstream to emit a final usage
	// chunk; otherwise streaming responses carry no token counts and we can't
	// compute cost. Don't clobber a caller-supplied stream_options. Adapters emit
	// their own usage chunk, so this OpenAI-only knob is skipped for them.
	if (!adapter && stream && wantsUsageChunk && isRecord(outboundBody)) {
		const existing = isRecord(outboundBody.stream_options) ? outboundBody.stream_options : {};
		outboundBody = { ...outboundBody, stream_options: { ...existing, include_usage: true } };
	}

	const upstreamUrl = adapter
		? adapter.buildUrl({ baseUrl: grant.baseUrl, scope, model, stream })
		: `${grant.baseUrl}${path}`;
	const upstreamBody = adapter ? adapter.translateRequest(scope, outboundBody) : outboundBody;

	// Realtime endpoints are gated behind `OpenAI-Beta: realtime=v1`; default it
	// when the client omitted the header, but honour a client-supplied value.
	const incomingBeta =
		event.request.headers.get('openai-beta') ?? (scope === 'realtime' ? 'realtime=v1' : null);
	const fetched = await fetchUpstream(ctx, provider, grant, upstreamUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// Forward the beta opt-in header some OpenAI endpoints require — e.g. the
			// Realtime endpoints need `OpenAI-Beta: realtime=v1`, and without it OpenAI
			// 404s the route. Only for pass-through providers; adapters speak their
			// own native API.
			...(!adapter && incomingBeta ? { 'openai-beta': incomingBeta } : {}),
			...authHeaders(provider, grant.apiKey)
		},
		body: JSON.stringify(upstreamBody)
	});
	if (!fetched.ok) return fetched.response;
	const { upstream } = fetched;

	// Streaming: the client gets the body untouched while usage is captured for
	// cost. For an adapter provider we first translate the native event stream
	// into OpenAI SSE, so both the client and the usage capture see that shape.
	if (stream && upstream.ok && upstream.body) {
		return streamWithRecording(ctx, {
			provider,
			upstream,
			source: adapter ? adapter.translateStream({ model }, upstream.body) : upstream.body,
			extract: openAiUsageExtractor,
			cache,
			detail: 'stream',
			release: grant.release
		});
	}

	// Buffered: translate (for adapter providers) then parse usage for cost. After
	// translation the body is OpenAI-shaped, so usage parsing, caching and the
	// returned payload all use the same code path as pass-through.
	const rawText = await upstream.text();
	const text = adapter
		? adapter.translateResponse({ scope, model, text: rawText, ok: upstream.ok })
		: rawText;
	await recordCompletion(ctx, {
		provider,
		statusCode: upstream.status,
		ok: upstream.ok,
		usage: usageFromText(text, bufferedOpenAiUsageExtractor),
		response: text,
		format: 'json',
		cache,
		complete: true,
		release: grant.release
	});

	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': 'application/json',
			...(cache ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}

/* ------------------------------------------------------------------------- */
/* Multipart pipeline                                                        */
/* ------------------------------------------------------------------------- */

export interface MultipartProxyOptions {
	auth: GatewayAuth;
	/** the gateway capability this request exercises (also the policy scope) */
	scope: Capability;
	model: string;
	/** upstream path appended to the provider base url, e.g. "/audio/transcriptions" */
	path: string;
	/** the multipart form to forward; `fetch` sets its own content-type + boundary */
	form: FormData;
	/** override the routed provider when both OpenAI and Azure are configured */
	preferProvider?: string;
}

/**
 * Model-routed proxy for endpoints whose request body is multipart/form-data —
 * audio transcriptions and image edits. It shares the JSON path's cross-cutting
 * concerns (route by model → capability check → policy → rate limit → budget →
 * audit), but forwards a rebuilt {@link FormData} instead of a JSON body, so the
 * uploaded bytes survive with their boundary intact. No caching or streaming: a
 * transcription isn't a deterministic, replayable request. Cost is best-effort —
 * token-billed models (gpt-4o-transcribe, gpt-image-1) report usage and are
 * priced; whisper-1 reports none and records a null cost.
 */
export async function proxyMultipartToProvider(
	event: RequestEvent,
	opts: MultipartProxyOptions
): Promise<Response> {
	const { auth, scope, model, path, form, preferProvider } = opts;
	// never store the raw multipart body (binary audio/images) on the trace —
	// record a compact request summary instead
	const ctx = createContext(event, auth, {
		scope,
		model,
		envelope: openAiEnvelope,
		traceRequest: { endpoint: path, model }
	});

	const provider = await resolveRoutedProvider(ctx, preferProvider);
	if (provider instanceof Response) return provider;

	const denied = await checkAccess(ctx, provider);
	if (denied) return denied;

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	// Forward the query string (Azure's ?api-version=… etc.) verbatim. Do NOT set
	// content-type: fetch derives the multipart boundary from the FormData body.
	const upstreamUrl = `${grant.baseUrl}${path}${event.url.search}`;
	const fetched = await fetchUpstream(ctx, provider, grant, upstreamUrl, {
		method: 'POST',
		headers: authHeaders(provider, grant.apiKey),
		body: form
	});
	if (!fetched.ok) return fetched.response;
	const { upstream } = fetched;

	// Buffer the response and parse usage best-effort. Transcriptions may return
	// JSON (`response_format=json|verbose_json`) or plain text (`text|srt|vtt`);
	// the latter simply yields no usage and a null cost.
	const text = await upstream.text();
	await recordCompletion(ctx, {
		provider,
		statusCode: upstream.status,
		ok: upstream.ok,
		usage: usageFromText(text, bufferedOpenAiUsageExtractor),
		response: text,
		cache: null,
		complete: true,
		release: grant.release
	});

	// Preserve the upstream content-type (json vs text/plain for srt/vtt).
	const outCt = upstream.headers.get('content-type') ?? 'application/json';
	return new Response(text, { status: upstream.status, headers: { 'content-type': outCt } });
}

/* ------------------------------------------------------------------------- */
/* Native Gemini pipeline                                                    */
/* ------------------------------------------------------------------------- */

export interface NativeGeminiOptions {
	auth: GatewayAuth;
	/** the gateway capability this request exercises (chat or embeddings) */
	scope: Capability;
	model: string;
	/** native method: generateContent | streamGenerateContent | embedContent | batchEmbedContents */
	method: string;
	stream: boolean;
	body: unknown;
}

/** Model names that are safe to interpolate into an upstream URL path. */
const SAFE_MODEL_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Native-ingress sibling of {@link proxyToProvider}. Accepts a request shaped for
 * Google's native Gemini REST API (sent by the `@google/genai` SDK pointed at
 * uprox) and forwards it to Gemini **verbatim** — no translation, so native-only
 * features (safety settings, thinking config, response schemas, cached content)
 * pass through with full fidelity. uprox's cross-cutting concerns still apply:
 * policy, rate limiting, budget, exact-match caching, cost accounting from the
 * native `usageMetadata`, and audit. Errors are returned in the native shape so
 * the Google SDK parses them. Routing is fixed to the Gemini provider — this
 * endpoint is the native Gemini API, not a model-routed surface.
 */
export async function proxyGeminiNative(
	event: RequestEvent,
	opts: NativeGeminiOptions
): Promise<Response> {
	const { auth, scope, model, method, stream, body } = opts;
	const provider = PROVIDERS.gemini;

	// defense-in-depth: `model` is interpolated raw into the upstream URL below, so
	// reject anything outside a safe model-name charset before it gets there.
	if (model && !SAFE_MODEL_NAME.test(model)) {
		return geminiEnvelope.error(400, 'Invalid model name', 'invalid_request');
	}

	const ctx = createContext(event, auth, {
		scope,
		model,
		envelope: geminiEnvelope,
		traceRequest: body
	});
	const { token } = ctx;

	const denied = await checkAccess(ctx, provider);
	if (denied) return denied;

	// exact-match cache. Determinism for native bodies: embeddings always;
	// generateContent only when sampling is pinned (generationConfig.temperature 0).
	const cacheTtl = token.effective.cacheTtlSeconds;
	const genCfg = isRecord(body) && isRecord(body.generationConfig) ? body.generationConfig : null;
	const deterministic = scope === 'embeddings' || (genCfg != null && genCfg.temperature === 0);
	const cacheable = (scope === 'chat' || scope === 'embeddings') && cacheTtl > 0 && deterministic;
	// Key on the native path + body; distinct from the OpenAI-ingress cache (which
	// keys on `/chat/completions` + an OpenAI body), so formats never cross.
	const cachePath = `/models/${model}:${method}`;
	const cache: CacheTarget | null = cacheable
		? {
				key: cacheKeyFor(provider.id, cachePath, body, token.providerSecretId),
				ttlSeconds: cacheTtl
			}
		: null;
	if (cache) {
		const hit = await replayCached(ctx, provider, cache.key, stream, 'native ');
		if (hit) return hit;
	}

	const grant = await acquireUpstream(ctx, provider);
	if (grant instanceof Response) return grant;

	// Forward the query string verbatim except `key` — the Google SDK may put the
	// API key there, and that's the uprox token, which must never reach Google.
	const search = new URLSearchParams(event.url.search);
	search.delete('key');
	const qs = search.toString();
	const upstreamUrl = `${grant.baseUrl}/models/${model}:${method}${qs ? `?${qs}` : ''}`;

	const fetched = await fetchUpstream(ctx, provider, grant, upstreamUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...authHeaders(provider, grant.apiKey)
		},
		body: JSON.stringify(body)
	});
	if (!fetched.ok) return fetched.response;
	const { upstream } = fetched;

	// streaming passthrough: the client gets the native SSE untouched while the
	// native usageMetadata is captured so we can still bill it.
	if (stream && upstream.ok && upstream.body) {
		return streamWithRecording(ctx, {
			provider,
			upstream,
			source: upstream.body,
			extract: geminiUsageExtractor,
			cache,
			detail: 'native stream',
			release: grant.release
		});
	}

	// buffered passthrough: read native usageMetadata for cost, return body as-is.
	const text = await upstream.text();
	await recordCompletion(ctx, {
		provider,
		statusCode: upstream.status,
		ok: upstream.ok,
		usage: usageFromText(text, geminiNativeUsage),
		response: text,
		format: 'json',
		detail: 'native',
		cache,
		complete: true,
		release: grant.release
	});

	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/json',
			...(cache ? { 'x-uprox-cache': 'MISS' } : {})
		}
	});
}

/**
 * Native model discovery for the Google GenAI SDK: `GET /v1beta/models` (list,
 * `ai.models.list()`) and `GET /v1beta/models/{model}` (get, `ai.models.get()`).
 * Proxies to Gemini and, for the list, drops models the token's policy forbids —
 * mirroring the OpenAI `/v1/models` catalog. Not billable: no cost, cache, or
 * budget, just auth + policy + passthrough.
 */
export async function proxyGeminiModels(
	event: RequestEvent,
	auth: GatewayAuth,
	model: string | null
): Promise<Response> {
	const { token, ip } = auth;
	const provider = PROVIDERS.gemini;

	// A specific model the policy forbids reads as "not found"; for the list we
	// gate at the provider level and return an empty catalog when gemini is fully
	// disallowed (no upstream call), matching the OpenAI models route.
	if (
		!evaluatePolicy(token, { provider: provider.id, model: model ?? '', scope: 'models' }).allow
	) {
		if (model) return geminiNativeError(404, `Model "${model}" is not available`, 'NOT_FOUND');
		return json({ models: [] });
	}

	// defense-in-depth: `model` is interpolated raw into the upstream URL below, so
	// reject anything outside a safe model-name charset (only for the get call —
	// `model` is null for the list call).
	if (model && !SAFE_MODEL_NAME.test(model)) {
		return geminiNativeError(404, `Model "${model}" is not available`, 'NOT_FOUND');
	}

	const creds = await loadProviderCreds(provider.id, token.providerSecretId);
	if (!creds) {
		return geminiNativeError(
			502,
			'No Google Gemini credentials configured for this instance',
			'FAILED_PRECONDITION'
		);
	}
	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		return geminiNativeError(502, 'No Google Gemini endpoint configured', 'FAILED_PRECONDITION');
	}

	// forward pagination/query verbatim, minus the auth `key` param
	const search = new URLSearchParams(event.url.search);
	search.delete('key');
	const qs = search.toString();
	const url = `${baseUrl}/models${model ? `/${model}` : ''}${qs ? `?${qs}` : ''}`;

	let upstream: Response;
	try {
		upstream = await fetch(url, { headers: authHeaders(provider, creds.apiKey) });
	} catch (err) {
		await audit({
			action: 'gateway.models',
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model: model ?? undefined,
			statusCode: 502,
			ip,
			detail: err instanceof Error ? err.message : 'upstream fetch failed'
		});
		return geminiNativeError(502, 'Upstream provider request failed', 'UNAVAILABLE');
	}

	const text = await upstream.text();
	if (!upstream.ok) {
		await audit({
			action: 'gateway.models',
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model: model ?? undefined,
			statusCode: upstream.status,
			ip,
			detail: model ? `get ${model}` : 'list'
		});
		return new Response(text, {
			status: upstream.status,
			headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }
		});
	}

	// models.get → return the single (already policy-checked) model object as-is
	if (model) {
		await audit({
			action: 'gateway.models',
			status: 'ok',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: provider.id,
			model,
			statusCode: 200,
			ip,
			detail: `get ${model}`
		});
		return new Response(text, {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	// models.list → filter the native array by the token's per-model policy,
	// preserving the native shape (and nextPageToken for pagination).
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = null;
	}
	const all = isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : [];
	const allowed = all.filter((m) => {
		const name = isRecord(m) && typeof m.name === 'string' ? m.name.replace(/^models\//, '') : '';
		return (
			Boolean(name) &&
			evaluatePolicy(token, { provider: provider.id, model: name, scope: 'models' }).allow
		);
	});
	const out: Record<string, unknown> = { models: allowed };
	if (isRecord(parsed) && typeof parsed.nextPageToken === 'string') {
		out.nextPageToken = parsed.nextPageToken;
	}

	await audit({
		action: 'gateway.models',
		status: 'ok',
		serviceId: token.serviceId,
		tokenId: token.tokenId,
		provider: provider.id,
		statusCode: 200,
		ip,
		detail: `${allowed.length} models`
	});
	return json(out);
}

/* ------------------------------------------------------------------------- */
/* Raw pass-through (Files API)                                              */
/* ------------------------------------------------------------------------- */

export interface RawProxyOptions {
	auth: GatewayAuth;
	/** which configured provider to route to (no model-based routing for files) */
	provider: 'openai' | 'azure';
	/** upstream path appended to the provider base url, e.g. "/files" */
	path: string;
}

/**
 * Stream-through proxy for endpoints whose body isn't JSON (Files API uploads
 * are multipart/form-data; downloads are binary). The request body and the
 * upstream response body are forwarded as opaque streams, so payload size and
 * content-type are preserved. Auth, provider selection, and audit are the same
 * as the JSON path, but model routing, policy by-model, caching, budget
 * estimation, and rate limiting are skipped — there's no model to scope by.
 *
 * Query strings (e.g. Azure's `?api-version=…`) are forwarded as-is so the
 * upstream sees the version the client specified.
 */
export async function proxyRawUpstream(
	event: RequestEvent,
	opts: RawProxyOptions
): Promise<Response> {
	const { auth, provider: providerId, path } = opts;
	const started = Date.now();
	const { token, ip } = auth;
	const method = event.request.method;

	const provider = PROVIDERS[providerId];
	if (!provider) return gatewayError(500, 'Unknown provider', 'api_error');

	// policy enforcement: the Files API has no model to scope by, so we gate on the
	// 'files' scope (and the policy's provider allowlist). An empty model skips the
	// model rules, so a token with no explicit scopes is still allowed — only a
	// token whose explicit scope list omits 'files', or a policy whose
	// allowedProviders excludes this provider, is denied.
	const decision = evaluatePolicy(token, { provider: providerId, model: '', scope: 'files' });
	if (!decision.allow) {
		await audit({
			action: 'policy.deny',
			status: 'deny',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 403,
			ip,
			detail: decision.reason
		});
		return gatewayError(403, `Request denied by policy: ${decision.reason}`, 'permission_error');
	}

	const creds = await loadProviderCreds(providerId, token.providerSecretId);
	if (!creds) {
		await audit({
			action: `gateway.files`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 502,
			ip,
			detail: `no ${providerId} secret configured`
		});
		return gatewayError(
			502,
			`No ${provider.label} credentials configured for this instance`,
			'api_error'
		);
	}

	const baseUrl = resolveBaseUrl(provider, creds.baseUrl);
	if (!baseUrl) {
		await audit({
			action: `gateway.files`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 502,
			ip,
			detail: `no ${providerId} endpoint configured`
		});
		return gatewayError(
			502,
			`No ${provider.label} endpoint configured for this instance`,
			'api_error'
		);
	}

	// Forward the original query string (api-version etc.) verbatim.
	const upstreamUrl = `${baseUrl}${path}${event.url.search}`;

	// Build upstream headers: keep the client's content-type so multipart
	// boundaries survive, drop hop-by-hop and host headers, override auth.
	const fwdHeaders: Record<string, string> = {};
	const ct = event.request.headers.get('content-type');
	if (ct) fwdHeaders['content-type'] = ct;
	const accept = event.request.headers.get('accept');
	if (accept) fwdHeaders['accept'] = accept;
	Object.assign(fwdHeaders, authHeaders(provider, creds.apiKey));

	const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method,
			headers: fwdHeaders,
			body: hasBody ? event.request.body : undefined,
			// Required by undici when streaming a request body.
			...(hasBody ? { duplex: 'half' } : {})
		} as RequestInit & { duplex?: 'half' });
	} catch (err) {
		await audit({
			action: `gateway.files`,
			status: 'error',
			serviceId: token.serviceId,
			tokenId: token.tokenId,
			provider: providerId,
			statusCode: 502,
			latencyMs: Date.now() - started,
			ip,
			detail: err instanceof Error ? err.message : 'upstream fetch failed'
		});
		return gatewayError(502, 'Upstream provider request failed', 'api_error');
	}

	await audit({
		action: `gateway.files`,
		status: upstream.ok ? 'ok' : 'error',
		serviceId: token.serviceId,
		tokenId: token.tokenId,
		provider: providerId,
		statusCode: upstream.status,
		latencyMs: Date.now() - started,
		ip,
		detail: `${method} ${path}`
	});

	// Stream the upstream response straight back, preserving content-type.
	const outHeaders = new Headers();
	const outCt = upstream.headers.get('content-type');
	if (outCt) outHeaders.set('content-type', outCt);
	const outCl = upstream.headers.get('content-length');
	if (outCl) outHeaders.set('content-length', outCl);
	return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

/* ------------------------------------------------------------------------- */
/* Endpoint descriptors                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Where an endpoint takes the model it routes by:
 * - `'body'`: the required `model` field of the JSON body or multipart form;
 * - `'deployment'`: the `[deployment]` route param (Azure deployment URLs),
 *   written over any `model` in the body or form;
 * - a function: a custom picker over the JSON body that always yields a model
 *   (used by the realtime endpoints, where the model is optional and nested).
 */
export type ModelSource = 'body' | 'deployment' | ((body: unknown) => string);

/** Declarative description of one model-routed gateway endpoint. */
export interface EndpointDescriptor {
	/** the gateway capability (and policy scope) the endpoint exercises */
	scope: Capability;
	/** upstream path appended to the provider base url */
	path: string;
	/** how the request body is read and forwarded */
	bodyKind: 'json' | 'multipart';
	/** whether `stream: true` in a JSON body turns on streaming */
	streamable: boolean;
	/** ask pass-through upstreams for a trailing usage chunk when streaming */
	wantsUsageChunk: boolean;
	/** URL-level provider preference (Azure-style routes) */
	preferProvider?: string;
	modelFrom: ModelSource;
}

/** Routing fallback for realtime requests that carry no model. */
const REALTIME_FALLBACK_MODEL = 'gpt-realtime';

/** The first non-empty string among the candidates, else the realtime fallback. */
function firstModel(...candidates: unknown[]): string {
	for (const c of candidates) if (typeof c === 'string' && c) return c;
	return REALTIME_FALLBACK_MODEL;
}

/**
 * `POST /realtime/client_secrets`: the model lives at `session.model` in the
 * current API (top-level `model` on the legacy shape).
 */
export function realtimeClientSecretModel(body: unknown): string {
	const session = isRecord(body) && isRecord(body.session) ? body.session : undefined;
	return firstModel(session?.model, isRecord(body) ? body.model : undefined);
}

/** `POST /realtime/sessions`: the model is top-level. */
export function realtimeSessionModel(body: unknown): string {
	return firstModel(isRecord(body) ? body.model : undefined);
}

/**
 * `POST /realtime/transcription_sessions`: the model (when present) is nested
 * under `input_audio_transcription.model`.
 */
export function realtimeTranscriptionSessionModel(body: unknown): string {
	const transcription =
		isRecord(body) && isRecord(body.input_audio_transcription)
			? body.input_audio_transcription
			: undefined;
	return firstModel(transcription?.model, isRecord(body) ? body.model : undefined);
}

/**
 * The OpenAI-compatible endpoints the gateway proxies by model. Route files pick
 * one of these (optionally through {@link azureStyle} / {@link azureDeployment})
 * and hand it to {@link gatewayEndpoint}.
 */
export const ENDPOINTS = {
	chatCompletions: {
		scope: 'chat',
		path: '/chat/completions',
		bodyKind: 'json',
		streamable: true,
		// streamed chat completions carry no token counts unless asked for
		wantsUsageChunk: true,
		modelFrom: 'body'
	},
	responses: {
		scope: 'responses',
		path: '/responses',
		bodyKind: 'json',
		streamable: true,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	embeddings: {
		scope: 'embeddings',
		path: '/embeddings',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	imageGenerations: {
		scope: 'images',
		path: '/images/generations',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	imageEdits: {
		scope: 'images',
		path: '/images/edits',
		bodyKind: 'multipart',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	audioTranscriptions: {
		scope: 'transcriptions',
		path: '/audio/transcriptions',
		bodyKind: 'multipart',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: 'body'
	},
	realtimeClientSecrets: {
		scope: 'realtime',
		path: '/realtime/client_secrets',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: realtimeClientSecretModel
	},
	realtimeSessions: {
		scope: 'realtime',
		path: '/realtime/sessions',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: realtimeSessionModel
	},
	realtimeTranscriptionSessions: {
		scope: 'realtime',
		path: '/realtime/transcription_sessions',
		bodyKind: 'json',
		streamable: false,
		wantsUsageChunk: false,
		modelFrom: realtimeTranscriptionSessionModel
	}
} as const satisfies Record<string, EndpointDescriptor>;

/**
 * Azure-style URL surface (`/openai/…`, `/openai/v1/…`): same contract, but the
 * URL signals Azure intent, so it beats the policy's preferredProvider when both
 * OpenAI and Azure are configured.
 */
export function azureStyle(d: EndpointDescriptor): EndpointDescriptor {
	return { ...d, preferProvider: 'azure' };
}

/**
 * Azure deployment URL surface (`/openai/deployments/{deployment}/…`): the
 * deployment name in the URL is the canonical model name. The `api-version`
 * query string is accepted (and forwarded on multipart calls).
 */
export function azureDeployment(d: EndpointDescriptor): EndpointDescriptor {
	return { ...d, preferProvider: 'azure', modelFrom: 'deployment' };
}

/**
 * Resolve the routing model and the body to forward for a JSON endpoint. Returns
 * null when a required `model` is missing.
 */
export function resolveJsonModel(
	modelFrom: ModelSource,
	body: unknown,
	deployment: string | undefined
): { model: string; body: unknown } | null {
	if (modelFrom === 'deployment') {
		if (!deployment) return null;
		return { model: deployment, body: { ...(isRecord(body) ? body : {}), model: deployment } };
	}
	if (typeof modelFrom === 'function') return { model: modelFrom(body), body };
	const model = isRecord(body) ? body.model : undefined;
	return typeof model === 'string' && model ? { model, body } : null;
}

/**
 * Build the SvelteKit handler for a model-routed endpoint: authenticate, read the
 * JSON or multipart body, resolve the model, then run the matching pipeline.
 */
export function gatewayEndpoint(d: EndpointDescriptor): RequestHandler {
	return async (event) => {
		const auth = await authenticateGateway(event);
		if (!auth.ok) return auth.response;

		let deployment: string | undefined;
		if (d.modelFrom === 'deployment') {
			deployment = event.params.deployment;
			if (!deployment) return gatewayError(400, 'Missing deployment name');
		}

		if (d.bodyKind === 'multipart') {
			let form: FormData;
			try {
				form = await event.request.formData();
			} catch {
				return gatewayError(400, 'Request body must be multipart/form-data');
			}
			if (deployment) form.set('model', deployment);
			const model = form.get('model');
			if (typeof model !== 'string' || !model) {
				return gatewayError(400, 'Missing required field: model');
			}
			return proxyMultipartToProvider(event, {
				auth: auth.auth,
				scope: d.scope,
				model,
				path: d.path,
				form,
				preferProvider: d.preferProvider
			});
		}

		let body: unknown;
		try {
			body = await event.request.json();
		} catch {
			return gatewayError(400, 'Request body must be valid JSON');
		}
		const resolved = resolveJsonModel(d.modelFrom, body, deployment);
		if (!resolved) return gatewayError(400, 'Missing required field: model');

		return proxyToProvider(event, {
			auth: auth.auth,
			scope: d.scope,
			model: resolved.model,
			path: d.path,
			body: resolved.body,
			stream: d.streamable && isRecord(body) && body.stream === true,
			preferProvider: d.preferProvider,
			wantsUsageChunk: d.wantsUsageChunk
		});
	};
}

/**
 * Build a Files API handler (stream-through, no model routing) for a fixed
 * provider: `'list'` is `/files`, `'file'` is `/files/{id}` and `'content'` is
 * `/files/{id}/content`.
 */
export function filesEndpoint(
	provider: RawProxyOptions['provider'],
	resource: 'list' | 'file' | 'content'
): RequestHandler {
	return async (event) => {
		const auth = await authenticateGateway(event);
		if (!auth.ok) return auth.response;
		if (resource === 'list') {
			return proxyRawUpstream(event, { auth: auth.auth, provider, path: '/files' });
		}
		const id = event.params.id;
		if (!id) return gatewayError(400, 'Missing file id');
		const filePath = `/files/${encodeURIComponent(id)}`;
		return proxyRawUpstream(event, {
			auth: auth.auth,
			provider,
			path: resource === 'content' ? `${filePath}/content` : filePath
		});
	};
}
