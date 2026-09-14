/** SQL fragments and labels shared by the token meter queries. */
import { sql } from 'drizzle-orm';
import { auditLog } from '$lib/server/db/schema';
import type { MeterKey, MeterTokenSums } from '$lib/features/usage/meters';
import { METER_META } from '$lib/features/usage/colors';

/**
 * Embedding traffic, matched on the model name. Embeddings are metered as their
 * own line — a provider never prompt-caches them and they bill at a fraction of
 * a chat rate — so every meter query carves them out of input/output first.
 */
export const EMBEDDING_MODEL = sql`${auditLog.model} ilike '%embedding%'`;

/**
 * The six sums every meter view needs, in the shape `$lib/features/usage/meters` expects.
 * Selected identically by each query so the three views can never partition the
 * same window differently.
 */
export const METER_SUM_SELECT = {
	inputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint`,
	outputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint`,
	cacheReadTokens: sql<number>`coalesce(sum(${auditLog.providerCachedTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint`,
	cacheWriteTokens: sql<number>`coalesce(sum(${auditLog.cacheWriteTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint`,
	embeddingInputTokens: sql<number>`coalesce(sum(${auditLog.inputTokens}) filter (where ${EMBEDDING_MODEL}), 0)::bigint`,
	embeddingOutputTokens: sql<number>`coalesce(sum(${auditLog.outputTokens}) filter (where ${EMBEDDING_MODEL}), 0)::bigint`
};

/** The same six sums for the raw-SQL queries, which alias in snake_case. */
export const METER_SUM_SQL = sql`
	coalesce(sum(${auditLog.inputTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint as input_tokens,
	coalesce(sum(${auditLog.outputTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint as output_tokens,
	coalesce(sum(${auditLog.providerCachedTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint as cache_read_tokens,
	coalesce(sum(${auditLog.cacheWriteTokens}) filter (where not (${EMBEDDING_MODEL})), 0)::bigint as cache_write_tokens,
	coalesce(sum(${auditLog.inputTokens}) filter (where ${EMBEDDING_MODEL}), 0)::bigint as embedding_input_tokens,
	coalesce(sum(${auditLog.outputTokens}) filter (where ${EMBEDDING_MODEL}), 0)::bigint as embedding_output_tokens
`;

/**
 * A type alias rather than an interface on purpose: `db.execute` constrains its
 * row type to `Record<string, unknown>`, which an interface can't satisfy
 * without an index signature but an anonymous object type satisfies implicitly.
 */
export type RawMeterSums = {
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	embedding_input_tokens: number;
	embedding_output_tokens: number;
};

export function meterSumsFromRow(r: RawMeterSums): MeterTokenSums {
	return {
		inputTokens: Number(r.input_tokens ?? 0),
		outputTokens: Number(r.output_tokens ?? 0),
		cacheReadTokens: Number(r.cache_read_tokens ?? 0),
		cacheWriteTokens: Number(r.cache_write_tokens ?? 0),
		embeddingInputTokens: Number(r.embedding_input_tokens ?? 0),
		embeddingOutputTokens: Number(r.embedding_output_tokens ?? 0)
	};
}

/** A meter's display name, shared with the composition bar's legend. */
export function meterLabel(key: MeterKey): string {
	return METER_META[key]?.label ?? key;
}

/** The same meter, abbreviated for composite labels — see {@link billingLineLabel}. */
export function meterShortLabel(key: MeterKey): string {
	return METER_META[key]?.short ?? key;
}
