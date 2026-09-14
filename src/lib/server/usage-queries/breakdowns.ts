/** Fixed-shape usage breakdowns by model, provider, service and token. */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, machineToken, auditLog } from '$lib/server/db/schema';
import type { ResolvedRange } from '$lib/usage-range';
import { usageConds } from '$lib/server/usage-queries/predicates';

export interface ModelUsage {
	model: string;
	provider: string | null;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic grouped by model over the window, busiest first. Powers the
 * "usage by model" breakdown on the usage page and (with `serviceId`) the
 * per-service detail page.
 */
export async function orgUsageByModel(
	range: ResolvedRange,
	opts: { serviceId?: string; tokenId?: string; limit?: number } = {}
): Promise<ModelUsage[]> {
	const rows = await db
		.select({
			model: auditLog.model,
			// a model is served by a single provider; max() picks a stable non-null id
			provider: sql<string | null>`max(${auditLog.provider})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.where(
			and(sql`${auditLog.model} is not null`, ...usageConds(range, opts.serviceId, opts.tokenId))
		)
		.groupBy(auditLog.model)
		.orderBy(desc(sql`count(*)`))
		.limit(opts.limit ?? 50);

	return rows.map((r) => ({
		model: r.model as string,
		provider: r.provider,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0)
	}));
}

export interface ProviderUsage {
	provider: string;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic grouped by upstream provider over the window, busiest first.
 * Coarser than the by-model breakdown — answers "where is the spend landing,
 * OpenAI vs Anthropic vs Azure" at a glance. Rows with no recorded provider
 * (e.g. denials before routing) are dropped.
 */
export async function orgUsageByProvider(
	range: ResolvedRange,
	opts: { serviceId?: string; tokenId?: string } = {}
): Promise<ProviderUsage[]> {
	const rows = await db
		.select({
			provider: auditLog.provider,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.where(
			and(sql`${auditLog.provider} is not null`, ...usageConds(range, opts.serviceId, opts.tokenId))
		)
		.groupBy(auditLog.provider)
		.orderBy(desc(sql`count(*)`));

	return rows.map((r) => ({
		provider: r.provider as string,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0)
	}));
}

export interface ServiceUsage {
	serviceId: string | null;
	serviceName: string | null;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
	savedInputTokens: number;
	savedOutputTokens: number;
	/** input tokens this service had served from the upstream provider's prompt cache */
	providerCachedTokens: number;
}

/**
 * Gateway traffic grouped by the calling service over the window, busiest first.
 * Requests whose service was since deleted group under a null id.
 */
export async function orgUsageByService(range: ResolvedRange): Promise<ServiceUsage[]> {
	const rows = await db
		.select({
			serviceId: auditLog.serviceId,
			serviceName: sql<string | null>`max(${service.name})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`,
			savedInputTokens: sql<number>`coalesce(sum(${auditLog.savedInputTokens}), 0)::bigint`,
			savedOutputTokens: sql<number>`coalesce(sum(${auditLog.savedOutputTokens}), 0)::bigint`,
			providerCachedTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}), 0)::bigint`
		})
		.from(auditLog)
		.leftJoin(service, eq(service.id, auditLog.serviceId))
		.where(and(...usageConds(range)))
		.groupBy(auditLog.serviceId)
		.orderBy(desc(sql`count(*)`));

	return rows.map((r) => ({
		serviceId: r.serviceId,
		serviceName: r.serviceName,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0),
		savedInputTokens: Number(r.savedInputTokens ?? 0),
		savedOutputTokens: Number(r.savedOutputTokens ?? 0),
		providerCachedTokens: Number(r.providerCachedTokens ?? 0)
	}));
}

export interface TokenUsage {
	tokenId: string | null;
	tokenName: string | null;
	tokenDisplay: string | null;
	serviceName: string | null;
	requests: number;
	costUsd: number;
	denied: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Gateway traffic grouped by the calling machine token over the window, busiest
 * first. Lets operators see which individual API key is driving spend (a service
 * can carry multiple tokens; a leaked one would stand out here long before the
 * per-service total looks unusual). Revoked tokens are still surfaced so
 * historical activity remains attributable. With `serviceId`, scopes to the
 * tokens of one service for the detail page.
 */
export async function orgUsageByToken(
	range: ResolvedRange,
	opts: { serviceId?: string; limit?: number } = {}
): Promise<TokenUsage[]> {
	const rows = await db
		.select({
			tokenId: auditLog.tokenId,
			tokenName: sql<string | null>`max(${machineToken.name})`,
			tokenDisplay: sql<string | null>`max(${machineToken.display})`,
			serviceName: sql<string | null>`max(${service.name})`,
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)::text`,
			denied: sql<number>`(count(*) filter (where ${auditLog.status} = 'deny'))::int`,
			inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}), 0)::bigint`,
			outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}), 0)::bigint`
		})
		.from(auditLog)
		.leftJoin(machineToken, eq(machineToken.id, auditLog.tokenId))
		.leftJoin(service, eq(service.id, machineToken.serviceId))
		.where(and(sql`${auditLog.tokenId} is not null`, ...usageConds(range, opts.serviceId)))
		.groupBy(auditLog.tokenId)
		.orderBy(desc(sql`count(*)`))
		.limit(opts.limit ?? 50);

	return rows.map((r) => ({
		tokenId: r.tokenId,
		tokenName: r.tokenName,
		tokenDisplay: r.tokenDisplay,
		serviceName: r.serviceName,
		requests: Number(r.requests ?? 0),
		costUsd: Number(r.cost ?? 0),
		denied: Number(r.denied ?? 0),
		inputTokens: Number(r.inputTokens ?? 0),
		outputTokens: Number(r.outputTokens ?? 0)
	}));
}
