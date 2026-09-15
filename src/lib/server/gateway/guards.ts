/** Access, cache replay and budget guards shared by the billable pipelines. */
import { evaluatePolicy } from '$lib/server/policy';
import { providerSupports, resolveBaseUrl, type ProviderDef } from '$lib/server/providers';
import { checkRateLimit } from '$lib/server/ratelimit';
import { checkBudget, reserve } from '$lib/server/budget';
import { maybeSendBudgetAlert, maybeSendInstanceBudgetAlert } from '$lib/server/budget-alerts';
import { getCached } from '$lib/server/cache';
import { loadProviderCreds } from './credentials';
import { reject, type RequestContext } from './context';

/**
 * Capability, policy and rate-limit checks shared by every model-routed
 * pipeline. Returns the (already audited) rejection, or null to continue.
 */
export async function checkAccess(
	ctx: RequestContext,
	provider: ProviderDef
): Promise<Response | null> {
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
export async function replayCached(
	ctx: RequestContext,
	provider: ProviderDef,
	cacheKey: string,
	stream: boolean,
	detailPrefix = ''
): Promise<Response | null> {
	const hit = await getCached(cacheKey);
	if (!hit) return null;
	await ctx.audit({
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
	});
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
export interface UpstreamGrant {
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
export async function acquireUpstream(
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
