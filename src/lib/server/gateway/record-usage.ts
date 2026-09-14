/** Usage extraction and the shared usage -> cost -> audit -> cache recorder. */
import { mapUsage } from '$lib/server/adapters/gemini';
import { normalizeUsage, type NormalizedUsage } from '$lib/server/usage';
import { putCached } from '$lib/server/cache';
import { estimateCost, type CostEstimate } from '$lib/server/pricing';
import type { ProviderDef } from '$lib/server/providers';
import { isRecord } from '$lib/server/json';
import type { RequestContext } from './context';

/**
 * Normalize usage from a *native* Gemini response (buffered or a streamed
 * chunk). `mapUsage` converts Gemini's `usageMetadata` into the OpenAI usage
 * shape, which `normalizeUsage` then folds into the gateway's common figure — so
 * native-ingress requests are costed by the exact same code as everything else.
 */
export function geminiNativeUsage(parsed: unknown): NormalizedUsage | null {
	if (!isRecord(parsed)) return null;
	const usageObj = mapUsage(parsed.usageMetadata);
	return usageObj ? normalizeUsage(usageObj) : null;
}

/**
 * Pull a usage figure out of one decoded JSON payload (a buffered response or a
 * streamed SSE chunk), or null if it carries none.
 */
export type UsageExtractor = (obj: Record<string, unknown>) => NormalizedUsage | null;

/**
 * The OpenAI stream extractor reads the chat shape (`{ usage }`) and the
 * Responses shape (`{ response: { usage } }`).
 */
export const openAiUsageExtractor: UsageExtractor = (obj) => {
	const u =
		(isRecord(obj.usage) && obj.usage) ||
		(isRecord(obj.response) && isRecord(obj.response.usage) && obj.response.usage);
	return u ? normalizeUsage(u) : null;
};

/** Buffered OpenAI-shaped responses carry usage at the top level only. */
export const bufferedOpenAiUsageExtractor: UsageExtractor = (obj) => normalizeUsage(obj.usage);

/** The native Gemini extractor reads `{ usageMetadata }`. */
export const geminiUsageExtractor: UsageExtractor = (obj) =>
	isRecord(obj.usageMetadata) ? geminiNativeUsage(obj) : null;

/** Usage from a buffered response body; null for non-JSON bodies or no usage. */
export function usageFromText(text: string, extract: UsageExtractor): NormalizedUsage | null {
	try {
		const parsed: unknown = JSON.parse(text);
		return isRecord(parsed) ? extract(parsed) : null;
	} catch {
		return null;
	}
}

/** Where a cacheable response is stored. */
export interface CacheTarget {
	key: string;
	ttlSeconds: number;
}

export interface CompletionRecord {
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
export async function recordCompletion(ctx: RequestContext, r: CompletionRecord): Promise<void> {
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
