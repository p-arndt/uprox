/**
 * Pure, client-safe helpers for the ingested-OTLP trace tree: assemble spans
 * into a parent/child tree, flatten it for a waterfall, and pull the
 * OpenInference attributes the span-detail panel renders. Best-effort — unknown
 * shapes degrade to the raw attribute table rather than breaking the view.
 */

export interface SpanLike {
	spanId: string;
	parentSpanId: string | null;
	name: string;
	kind?: string | null;
	status: string;
	startedAt: string | Date;
	durationMs: number;
	/** jsonb from the DB, so typed loosely; narrowed via `attrs()` before reads */
	attributes?: unknown;
}

function attrs(s: SpanLike): Record<string, unknown> {
	return typeof s.attributes === 'object' && s.attributes !== null && !Array.isArray(s.attributes)
		? (s.attributes as Record<string, unknown>)
		: {};
}

export interface SpanNode extends SpanLike {
	children: SpanNode[];
	/** nesting depth from the root (root = 0) */
	depth: number;
}

const startMs = (s: SpanLike) => new Date(s.startedAt).getTime();

/**
 * Build the span forest. Spans whose parent isn't in the set (or which have no
 * parent) become roots, so an incomplete trace still renders. Siblings are
 * ordered by start time. Cycles are guarded against, just in case.
 */
export function buildSpanTree(spans: SpanLike[]): SpanNode[] {
	const nodes = new Map<string, SpanNode>();
	for (const s of spans) nodes.set(s.spanId, { ...s, children: [], depth: 0 });

	const roots: SpanNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentSpanId ? nodes.get(node.parentSpanId) : undefined;
		if (parent && parent !== node) parent.children.push(node);
		else roots.push(node);
	}

	const byStart = (a: SpanNode, b: SpanNode) => startMs(a) - startMs(b);
	const setDepth = (node: SpanNode, depth: number, seen: Set<string>) => {
		node.depth = depth;
		node.children.sort(byStart);
		for (const c of node.children) {
			if (seen.has(c.spanId)) continue;
			seen.add(c.spanId);
			setDepth(c, depth + 1, seen);
		}
	};
	roots.sort(byStart);
	for (const r of roots) setDepth(r, 0, new Set([r.spanId]));
	return roots;
}

/** Depth-first flatten of the tree, for rendering an indented waterfall list. */
export function flattenTree(roots: SpanNode[]): SpanNode[] {
	const out: SpanNode[] = [];
	const walk = (n: SpanNode) => {
		out.push(n);
		for (const c of n.children) walk(c);
	};
	for (const r of roots) walk(r);
	return out;
}

/** The trace's time window [start, end] in ms across all spans. */
export function traceWindow(spans: SpanLike[]): { start: number; end: number } {
	if (spans.length === 0) return { start: 0, end: 1 };
	let start = Infinity;
	let end = -Infinity;
	for (const s of spans) {
		const a = startMs(s);
		start = Math.min(start, a);
		end = Math.max(end, a + (s.durationMs || 0));
	}
	return { start, end: Math.max(end, start + 1) };
}

function str(v: unknown): string | null {
	return typeof v === 'string' ? v : v == null ? null : String(v);
}
function num(v: unknown): number | null {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	return Number.isFinite(n) ? n : null;
}

/**
 * OpenInference span kind (`openinference.span.kind`): LLM, RETRIEVER, EMBEDDING,
 * TOOL, CHAIN, AGENT, RERANKER, … Falls back to the OTLP span kind.
 */
export function spanKind(s: SpanLike): string | null {
	const a = attrs(s);
	return str(a['openinference.span.kind']) ?? s.kind ?? null;
}

export interface SpanDetail {
	kind: string | null;
	model: string | null;
	input: string | null;
	output: string | null;
	tokensIn: number | null;
	tokensOut: number | null;
}

/** Pull the headline OpenInference fields for the span-detail panel. */
export function spanDetail(s: SpanLike): SpanDetail {
	const a = attrs(s);
	return {
		kind: spanKind(s),
		model: str(a['llm.model_name']) ?? str(a['llm.model']) ?? str(a['embedding.model_name']),
		input: str(a['input.value']),
		output: str(a['output.value']),
		tokensIn: num(a['llm.token_count.prompt']),
		tokensOut: num(a['llm.token_count.completion'])
	};
}
