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

/**
 * Reassemble an SSE wire body into the assistant's reply: concatenated text plus
 * any tool calls. Spans OpenAI chat (`choices[].delta.{content,tool_calls}` —
 * tool-call name/args arrive in fragments, accumulated by index), the Responses
 * API (`output_text.delta` text + `function_call` item/argument-delta events),
 * and native Gemini (`candidates[].content.parts[].{text,functionCall}`).
 */
function sseMessage(raw: string): { text: string; toolCalls: ToolCall[] } {
	let text = '';
	// insertion-ordered so tool calls render in the order the model emitted them
	const calls = new Map<string, ToolCall>();
	const ensure = (key: string) => {
		let c = calls.get(key);
		if (!c) {
			c = { name: '', args: '' };
			calls.set(key, c);
		}
		return c;
	};

	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) continue;
		const data = trimmed.slice(5).trim();
		if (!data || data === '[DONE]') continue;
		const obj = safeParse(data);
		if (!isRecord(obj)) continue;

		// OpenAI chat completions
		if (Array.isArray(obj.choices)) {
			for (const ch of obj.choices) {
				if (!isRecord(ch) || !isRecord(ch.delta)) continue;
				const delta = ch.delta;
				if (typeof delta.content === 'string') text += delta.content;
				if (Array.isArray(delta.tool_calls)) {
					for (const tc of delta.tool_calls) {
						if (!isRecord(tc)) continue;
						const key = `c${typeof tc.index === 'number' ? tc.index : calls.size}`;
						const c = ensure(key);
						if (isRecord(tc.function)) {
							if (typeof tc.function.name === 'string') c.name = tc.function.name;
							if (typeof tc.function.arguments === 'string') c.args += tc.function.arguments;
						}
					}
				}
			}
			continue;
		}

		// OpenAI Responses API streaming events
		if (typeof obj.type === 'string') {
			if (obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
				text += obj.delta;
				continue;
			}
			if (
				obj.type === 'response.output_item.added' &&
				isRecord(obj.item) &&
				obj.item.type === 'function_call'
			) {
				const id = typeof obj.item.id === 'string' ? obj.item.id : String(calls.size);
				const c = ensure(`r${id}`);
				if (typeof obj.item.name === 'string') c.name = obj.item.name;
				continue;
			}
			if (obj.type === 'response.function_call_arguments.delta' && typeof obj.delta === 'string') {
				const id = typeof obj.item_id === 'string' ? obj.item_id : '0';
				ensure(`r${id}`).args += obj.delta;
				continue;
			}
		}

		// Native Gemini
		if (Array.isArray(obj.candidates)) {
			for (const cand of obj.candidates) {
				if (!isRecord(cand) || !isRecord(cand.content)) continue;
				text += flattenContent(cand.content.parts);
				const tcs = geminiToolCalls(cand.content.parts);
				if (tcs) for (const tc of tcs) calls.set(`g${calls.size}`, { ...tc });
			}
		}
	}

	return { text, toolCalls: [...calls.values()].filter((c) => c.name || c.args) };
}

/** Backwards-compatible text-only reassembly of an SSE body. */
export function reconstructSse(raw: string): string {
	return sseMessage(raw).text;
}

/** Extract the assistant's reply (text + tool calls) from a buffered JSON body. */
function bufferedMessage(body: unknown): { text: string; toolCalls: ToolCall[] } {
	const append = (acc: string, next: string) => (next ? (acc ? `${acc}\n${next}` : next) : acc);
	if (!isRecord(body)) return { text: '', toolCalls: [] };

	// OpenAI chat completions
	if (Array.isArray(body.choices)) {
		let text = '';
		const calls: ToolCall[] = [];
		for (const ch of body.choices) {
			if (!isRecord(ch) || !isRecord(ch.message)) continue;
			text = append(text, flattenContent(ch.message.content));
			const tc = toolCallsFrom(ch.message);
			if (tc) calls.push(...tc);
		}
		return { text, toolCalls: calls };
	}

	// OpenAI Responses API: `output_text` convenience, else walk `output` items
	if (typeof body.output_text === 'string' || Array.isArray(body.output)) {
		let text = typeof body.output_text === 'string' ? body.output_text : '';
		const calls: ToolCall[] = [];
		if (Array.isArray(body.output)) {
			for (const item of body.output) {
				if (!isRecord(item)) continue;
				if (item.type === 'function_call') {
					calls.push({
						name: typeof item.name === 'string' ? item.name : 'function',
						args: typeof item.arguments === 'string' ? item.arguments : ''
					});
				} else if (!body.output_text) {
					text = append(text, flattenContent(item.content));
				}
			}
		}
		return { text, toolCalls: calls };
	}

	// Native Gemini
	if (Array.isArray(body.candidates)) {
		let text = '';
		const calls: ToolCall[] = [];
		for (const cand of body.candidates) {
			if (!isRecord(cand) || !isRecord(cand.content)) continue;
			text = append(text, flattenContent(cand.content.parts));
			const tc = geminiToolCalls(cand.content.parts);
			if (tc) calls.push(...tc);
		}
		return { text, toolCalls: calls };
	}

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
	return m ? m[1].toLowerCase() : null;
}

/** Pretty-print a JSON string for the raw view; returns the input unchanged if not JSON. */
export function prettyJson(text: string | null | undefined): string {
	if (!text) return '';
	const parsed = safeParse(text);
	return parsed == null ? text : JSON.stringify(parsed, null, 2);
}
