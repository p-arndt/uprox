/**
 * Pure, client-safe helpers for the trace viewer: turn a captured request /
 * response payload (OpenAI or native Gemini shape, buffered JSON or streamed
 * SSE) into a normalized conversation for display. Best-effort throughout — an
 * unrecognized shape yields an empty result and the UI falls back to the raw
 * payload tab, so a new provider shape never breaks the page.
 */

export interface ToolCall {
	name: string;
	/** the call arguments as a JSON string (possibly partial for a truncated stream) */
	args: string;
}

export interface TraceMessage {
	/** system | user | assistant | tool | model | … (verbatim from the payload) */
	role: string;
	/** flattened text content */
	text: string;
	/** tool/function calls requested in this message, if any */
	toolCalls?: ToolCall[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parse JSON without throwing; returns null on any failure. */
export function safeParse(text: string | null | undefined): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Flatten a message `content` field to plain text. Handles a bare string, the
 * OpenAI content-parts array (`[{ type: 'text', text }, …]`), and Gemini parts
 * (`[{ text }, …]`); non-text parts (images, audio) are noted as a placeholder.
 */
export function flattenContent(content: unknown): string {
	if (content == null) return '';
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === 'string') return part;
				if (isRecord(part)) {
					if (typeof part.text === 'string') return part.text;
					if (typeof part.type === 'string') return `[${part.type}]`;
				}
				return '';
			})
			.filter(Boolean)
			.join('\n');
	}
	if (isRecord(content) && typeof content.text === 'string') return content.text;
	return '';
}

/** Read OpenAI `tool_calls` (chat shape) off a message into normalized calls. */
function toolCallsFrom(msg: Record<string, unknown>): ToolCall[] | undefined {
	const calls = msg.tool_calls;
	if (!Array.isArray(calls)) return undefined;
	const out = calls
		.map((c) => {
			if (!isRecord(c) || !isRecord(c.function)) return null;
			const name = typeof c.function.name === 'string' ? c.function.name : 'function';
			const args = typeof c.function.arguments === 'string' ? c.function.arguments : '';
			return { name, args };
		})
		.filter((c): c is ToolCall => c !== null);
	return out.length ? out : undefined;
}

/** Read Gemini `functionCall` parts (`{ functionCall: { name, args } }`) into calls. */
function geminiToolCalls(parts: unknown): ToolCall[] | undefined {
	if (!Array.isArray(parts)) return undefined;
	const out: ToolCall[] = [];
	for (const part of parts) {
		if (isRecord(part) && isRecord(part.functionCall)) {
			const fc = part.functionCall;
			out.push({
				name: typeof fc.name === 'string' ? fc.name : 'function',
				args: fc.args != null ? JSON.stringify(fc.args) : ''
			});
		}
	}
	return out.length ? out : undefined;
}

/** Render Gemini `functionResponse` parts (tool results) to readable text. */
function geminiToolResults(parts: unknown): string {
	if (!Array.isArray(parts)) return '';
	return parts
		.map((part) => {
			if (isRecord(part) && isRecord(part.functionResponse)) {
				const fr = part.functionResponse;
				const name = typeof fr.name === 'string' ? fr.name : 'function';
				return `${name} → ${fr.response != null ? JSON.stringify(fr.response) : ''}`;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n');
}

/** Pull the OpenAI chat `messages` array into normalized messages. */
function openAiMessages(messages: unknown[]): TraceMessage[] {
	return messages.filter(isRecord).map((m) => ({
		role: typeof m.role === 'string' ? m.role : 'user',
		text: flattenContent(m.content),
		toolCalls: toolCallsFrom(m)
	}));
}

/**
 * Pull Gemini native `contents` into normalized messages, surfacing
 * `functionCall` parts as tool calls and `functionResponse` parts (tool
 * results) as a `tool`-role message.
 */
function geminiMessages(contents: unknown[]): TraceMessage[] {
	return contents.filter(isRecord).map((c) => {
		const parts = c.parts;
		const toolResults = geminiToolResults(parts);
		const text = flattenContent(parts);
		// a content carrying a functionResponse is the tool's reply, not the user's
		const role = toolResults ? 'tool' : typeof c.role === 'string' ? c.role : 'user';
		return {
			role,
			text: toolResults ? [text, toolResults].filter(Boolean).join('\n') : text,
			toolCalls: geminiToolCalls(parts)
		};
	});
}

/**
 * Extract the prompt as a list of messages from a captured request body.
 * Covers OpenAI chat (`messages`), the Responses API (`input` as string or
 * array), native Gemini (`contents` + optional `systemInstruction`), and
 * embeddings (`input`). Returns [] when nothing recognizable is present.
 */
export function requestMessages(requestBody: string | null | undefined): TraceMessage[] {
	const body = safeParse(requestBody);
	if (!isRecord(body)) return [];

	// OpenAI / Azure chat completions
	if (Array.isArray(body.messages)) return openAiMessages(body.messages);

	// OpenAI Responses API: `input` is either a string or a messages-like array
	if (typeof body.input === 'string' && !('contents' in body)) {
		return [{ role: 'user', text: body.input }];
	}
	if (Array.isArray(body.input) && !('contents' in body)) {
		// could be embeddings (array of strings) or responses (array of messages)
		if (body.input.every((i) => typeof i === 'string')) {
			return [{ role: 'user', text: (body.input as string[]).join('\n') }];
		}
		return openAiMessages(body.input);
	}

	// Native Gemini
	if (Array.isArray(body.contents)) {
		const msgs: TraceMessage[] = [];
		if (isRecord(body.systemInstruction)) {
			const text = flattenContent(body.systemInstruction.parts);
			if (text) msgs.push({ role: 'system', text });
		}
		return msgs.concat(geminiMessages(body.contents));
	}

	return [];
}

/** The assistant's reply reassembled from a response payload. */
interface ReplyParts {
	text: string;
	toolCalls: ToolCall[];
}

/** Mutable accumulator for an SSE reply. */
interface SseReply {
	text: string;
	/** insertion-ordered so tool calls render in the order the model emitted them */
	calls: Map<string, ToolCall>;
}

/** Get the tool call stored under `key`, creating an empty one on first sight. */
function ensureCall(calls: Map<string, ToolCall>, key: string): ToolCall {
	let c = calls.get(key);
	if (!c) {
		c = { name: '', args: '' };
		calls.set(key, c);
	}
	return c;
}

/** The JSON object carried by an SSE `data:` line, or null for anything else. */
function sseEvent(line: string): Record<string, unknown> | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) return null;
	const data = trimmed.slice(5).trim();
	if (!data || data === '[DONE]') return null;
	const obj = safeParse(data);
	return isRecord(obj) ? obj : null;
}

/** Merge one streamed OpenAI chat tool-call fragment (accumulated by index). */
function applyChatToolCallDelta(acc: SseReply, tc: unknown): void {
	if (!isRecord(tc)) return;
	const c = ensureCall(acc.calls, `c${typeof tc.index === 'number' ? tc.index : acc.calls.size}`);
	if (!isRecord(tc.function)) return;
	if (typeof tc.function.name === 'string') c.name = tc.function.name;
	if (typeof tc.function.arguments === 'string') c.args += tc.function.arguments;
}

/** OpenAI chat completions chunk: `choices[].delta.{content,tool_calls}`. */
function applyChatChunk(acc: SseReply, choices: unknown[]): void {
	for (const ch of choices) {
		if (!isRecord(ch) || !isRecord(ch.delta)) continue;
		const delta = ch.delta;
		if (typeof delta.content === 'string') acc.text += delta.content;
		if (!Array.isArray(delta.tool_calls)) continue;
		for (const tc of delta.tool_calls) applyChatToolCallDelta(acc, tc);
	}
}

/**
 * OpenAI Responses API streaming event: `output_text.delta` text plus
 * `function_call` item/argument-delta events. Returns false when the event is
 * none of those, so the caller can try the next format.
 */
function applyResponsesEvent(acc: SseReply, obj: Record<string, unknown>): boolean {
	if (obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
		acc.text += obj.delta;
		return true;
	}
	if (
		obj.type === 'response.output_item.added' &&
		isRecord(obj.item) &&
		obj.item.type === 'function_call'
	) {
		const id = typeof obj.item.id === 'string' ? obj.item.id : String(acc.calls.size);
		const c = ensureCall(acc.calls, `r${id}`);
		if (typeof obj.item.name === 'string') c.name = obj.item.name;
		return true;
	}
	if (obj.type === 'response.function_call_arguments.delta' && typeof obj.delta === 'string') {
		const id = typeof obj.item_id === 'string' ? obj.item_id : '0';
		ensureCall(acc.calls, `r${id}`).args += obj.delta;
		return true;
	}
	return false;
}

/** Native Gemini chunk: `candidates[].content.parts[].{text,functionCall}`. */
function applyGeminiChunk(acc: SseReply, candidates: unknown[]): void {
	for (const cand of candidates) {
		if (!isRecord(cand) || !isRecord(cand.content)) continue;
		acc.text += flattenContent(cand.content.parts);
		for (const tc of geminiToolCalls(cand.content.parts) ?? []) {
			acc.calls.set(`g${acc.calls.size}`, { ...tc });
		}
	}
}

/** Fold one SSE event into the reply, trying chat, Responses API, then Gemini. */
function applySseEvent(acc: SseReply, obj: Record<string, unknown>): void {
	if (Array.isArray(obj.choices)) return applyChatChunk(acc, obj.choices);
	if (applyResponsesEvent(acc, obj)) return;
	if (Array.isArray(obj.candidates)) applyGeminiChunk(acc, obj.candidates);
}

/**
 * Reassemble an SSE wire body into the assistant's reply: concatenated text plus
 * any tool calls. Spans OpenAI chat (`choices[].delta.{content,tool_calls}` —
 * tool-call name/args arrive in fragments, accumulated by index), the Responses
 * API (`output_text.delta` text + `function_call` item/argument-delta events),
 * and native Gemini (`candidates[].content.parts[].{text,functionCall}`).
 */
function sseMessage(raw: string): ReplyParts {
	const acc: SseReply = { text: '', calls: new Map() };
	for (const line of raw.split('\n')) {
		const obj = sseEvent(line);
		if (obj) applySseEvent(acc, obj);
	}
	return { text: acc.text, toolCalls: [...acc.calls.values()].filter((c) => c.name || c.args) };
}

/** Backwards-compatible text-only reassembly of an SSE body. */
export function reconstructSse(raw: string): string {
	return sseMessage(raw).text;
}

/** Join two text blocks with a newline, skipping an empty addition. */
function appendLine(acc: string, next: string): string {
	if (!next) return acc;
	return acc ? `${acc}\n${next}` : next;
}

/** Buffered OpenAI chat completion: `choices[].message`. */
function bufferedChat(choices: unknown[]): ReplyParts {
	let text = '';
	const toolCalls: ToolCall[] = [];
	for (const ch of choices) {
		if (!isRecord(ch) || !isRecord(ch.message)) continue;
		text = appendLine(text, flattenContent(ch.message.content));
		toolCalls.push(...(toolCallsFrom(ch.message) ?? []));
	}
	return { text, toolCalls };
}

/** Buffered Responses API body: `output_text` convenience, else walk `output` items. */
function bufferedResponses(body: Record<string, unknown>): ReplyParts {
	let text = typeof body.output_text === 'string' ? body.output_text : '';
	const toolCalls: ToolCall[] = [];
	const output = Array.isArray(body.output) ? body.output : [];
	for (const item of output) {
		if (!isRecord(item)) continue;
		if (item.type === 'function_call') {
			toolCalls.push({
				name: typeof item.name === 'string' ? item.name : 'function',
				args: typeof item.arguments === 'string' ? item.arguments : ''
			});
		} else if (!body.output_text) {
			text = appendLine(text, flattenContent(item.content));
		}
	}
	return { text, toolCalls };
}

/** Buffered native Gemini response: `candidates[].content.parts`. */
function bufferedGemini(candidates: unknown[]): ReplyParts {
	let text = '';
	const toolCalls: ToolCall[] = [];
	for (const cand of candidates) {
		if (!isRecord(cand) || !isRecord(cand.content)) continue;
		text = appendLine(text, flattenContent(cand.content.parts));
		toolCalls.push(...(geminiToolCalls(cand.content.parts) ?? []));
	}
	return { text, toolCalls };
}

/** Extract the assistant's reply (text + tool calls) from a buffered JSON body. */
function bufferedMessage(body: unknown): ReplyParts {
	if (!isRecord(body)) return { text: '', toolCalls: [] };
	if (Array.isArray(body.choices)) return bufferedChat(body.choices);
	if (typeof body.output_text === 'string' || Array.isArray(body.output)) {
		return bufferedResponses(body);
	}
	if (Array.isArray(body.candidates)) return bufferedGemini(body.candidates);
	return { text: '', toolCalls: [] };
}

/**
 * The assistant's reply for the conversation view (text + tool calls):
 * reconstructed from the SSE stream when streamed, else read from the buffered
 * JSON. Returns an empty assistant message when nothing recognizable is present.
 */
export function responseMessage(
	responseBody: string | null | undefined,
	format: string | null | undefined
): TraceMessage {
	if (!responseBody) return { role: 'assistant', text: '' };
	const { text, toolCalls } =
		format === 'sse' ? sseMessage(responseBody) : bufferedMessage(safeParse(responseBody));
	return { role: 'assistant', text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

/** Backwards-compatible text-only accessor for the assistant's reply. */
export function responseText(
	responseBody: string | null | undefined,
	format: string | null | undefined
): string {
	return responseMessage(responseBody, format).text;
}

/**
 * Extract the 32-hex trace-id from a W3C `traceparent` header value
 * (`<version>-<trace-id>-<parent-id>-<flags>`), lower-cased, or null if the
 * value isn't a well-formed traceparent. Used to auto-group gateway calls under
 * the caller's existing OpenTelemetry trace with no client changes.
 */
export function parseTraceparent(value: string | null | undefined): string | null {
	if (!value) return null;
	const m = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i.exec(value.trim());
	return m?.[1]?.toLowerCase() ?? null;
}

/**
 * Merge caller-supplied trace metadata into one object: the `x-uprox-metadata`
 * JSON-object header plus any `x-uprox-meta-<key>: <value>` header pairs (string
 * values). Returns null when nothing usable is present. Generic by design — no
 * key is special-cased.
 */
export function parseTraceMetadata(
	jsonHeader: string | null | undefined,
	headerPairs: Iterable<[string, string]> = []
): Record<string, unknown> | null {
	const out: Record<string, unknown> = {};
	if (jsonHeader) {
		const parsed = safeParse(jsonHeader);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			Object.assign(out, parsed as Record<string, unknown>);
		}
	}
	const prefix = 'x-uprox-meta-';
	for (const [name, value] of headerPairs) {
		const lower = name.toLowerCase();
		if (lower.startsWith(prefix)) {
			const key = lower.slice(prefix.length);
			if (key) out[key] = value;
		}
	}
	return Object.keys(out).length ? out : null;
}

export interface MetaFilter {
	key: string;
	/** exact value to match; null = match any trace that has the key at all */
	value: string | null;
}

/**
 * Parse a metadata filter expression for the traces list. `key:value` or
 * `key=value` matches that exact pair; a bare `key` matches any trace carrying
 * that key. Returns null when there's nothing to filter on.
 */
export function parseMetaFilter(input: string | null | undefined): MetaFilter | null {
	const t = input?.trim();
	if (!t) return null;
	const sep = t.search(/[:=]/);
	if (sep === -1) return { key: t, value: null }; // bare key → existence filter
	const key = t.slice(0, sep).trim();
	const value = t.slice(sep + 1).trim();
	return key ? { key, value: value || null } : null;
}

/** Pretty-print a JSON string for the raw view; returns the input unchanged if not JSON. */
export function prettyJson(text: string | null | undefined): string {
	if (!text) return '';
	const parsed = safeParse(text);
	return parsed == null ? text : JSON.stringify(parsed, null, 2);
}

/** The raw response payload for display: SSE streams verbatim, JSON pretty-printed. */
export function rawResponseBody(
	body: string | null | undefined,
	format: string | null | undefined
): string {
	return format === 'sse' ? (body ?? '') : prettyJson(body);
}

/** A time range in epoch ms. */
export interface TimeWindow {
	start: number;
	end: number;
}

/** The shape of a gateway call the waterfall needs. */
export interface TimedCall {
	createdAt: string | Date;
	latencyMs?: number | null;
}

/**
 * A gateway call's span. The proxy only records completion time and latency, so
 * the call is laid out as end = createdAt, start = end − latency.
 */
export function callSpan(call: TimedCall): TimeWindow {
	const end = new Date(call.createdAt).getTime();
	return { start: end - (call.latencyMs ?? 0), end };
}

/** The window covering every call; `{ start: 0, end: 0 }` when there are none. */
export function callsWindow(calls: TimedCall[]): TimeWindow {
	if (calls.length === 0) return { start: 0, end: 0 };
	let start = Infinity;
	let end = -Infinity;
	for (const c of calls) {
		const s = callSpan(c);
		start = Math.min(start, s.start);
		end = Math.max(end, s.end);
	}
	return { start, end };
}

/**
 * Position of a waterfall bar as percentages of the window. The width never
 * drops below `minWidthPct` so instant spans stay visible.
 */
export function waterfallBar(
	startMs: number,
	durationMs: number,
	win: TimeWindow,
	minWidthPct: number
): { left: number; width: number } {
	const total = Math.max(1, win.end - win.start);
	return {
		left: ((startMs - win.start) / total) * 100,
		width: Math.max(minWidthPct, (durationMs / total) * 100)
	};
}
