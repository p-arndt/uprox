/** The decoded span row both OTLP readers produce, plus the helpers they share. */

export interface ParsedSpan {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	name: string;
	/** OTLP span kind name (INTERNAL | SERVER | CLIENT | PRODUCER | CONSUMER) */
	kind: string | null;
	startedAt: Date;
	durationMs: number;
	status: 'ok' | 'error' | 'unset';
	serviceName: string | null;
	/** flattened attributes (OpenInference keys etc.) */
	attributes: Record<string, unknown>;
}

export const SPAN_KINDS = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];

// Cap on OTLP AnyValue nesting (array/kvlist) the decoders will descend into.
// A maliciously deep payload (protobuf or JSON) would otherwise recurse until
// the call stack overflows and crashes the process; past this depth we stop
// descending and substitute a truncation marker instead.
export const MAX_DEPTH = 32;

export function kindName(kind: number | null): string | null {
	if (kind == null || kind <= 0) return null;
	return SPAN_KINDS[kind] ?? null;
}

export function statusName(code: number): 'ok' | 'error' | 'unset' {
	return code === 1 ? 'ok' : code === 2 ? 'error' : 'unset';
}

/** nanoseconds (bigint) → Date (ms) and a ms duration that stays within Number range. */
export function spanTiming(
	startNs: bigint,
	endNs: bigint
): { startedAt: Date; durationMs: number } {
	const startedAt = new Date(Number(startNs / 1_000_000n));
	const durationMs = endNs > startNs ? Number((endNs - startNs) / 1_000_000n) : 0;
	return { startedAt, durationMs };
}
