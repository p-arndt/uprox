/**
 * Pure, client-safe helpers for the trace viewer: turn a captured request /
 * response payload (OpenAI or native Gemini shape, buffered JSON or streamed
 * SSE) into a normalized conversation for display. Best-effort throughout — an
 * unrecognized shape yields an empty result and the UI falls back to the raw
 * payload tab, so a new provider shape never breaks the page.
 */

export interface TraceMessage {
	/** system | user | assistant | tool | model | … (verbatim from the payload) */
	role: string;
	/** flattened text content */
	text: string;
	/** tool/function calls requested in this message, if any */
	toolCalls?: { name: string; args: string }[];
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

function toolCallsFrom(msg: Record<string, unknown>): { name: string; args: string }[] | undefined {
	const calls = msg.tool_calls;
	if (!Array.isArray(calls)) return undefined;
	const out = calls
		.map((c) => {
			if (!isRecord(c) || !isRecord(c.function)) return null;
			const name = typeof c.function.name === 'string' ? c.function.name : 'function';
			const args = typeof c.function.arguments === 'string' ? c.function.arguments : '';
			return { name, args };
		})
		.filter((c): c is { name: string; args: string } => c !== null);
	return out.length ? out : undefined;
}

/** Pull the OpenAI chat `messages` array into normalized messages. */
function openAiMessages(messages: unknown[]): TraceMessage[] {
	return messages.filter(isRecord).map((m) => ({
		role: typeof m.role === 'string' ? m.role : 'user',
		text: flattenContent(m.content),
		toolCalls: toolCallsFrom(m)
	}));
}

/** Pull Gemini native `contents` into normalized messages. */
function geminiMessages(contents: unknown[]): TraceMessage[] {
	return contents.filter(isRecord).map((c) => ({
		role: typeof c.role === 'string' ? c.role : 'user',
		text: flattenContent(c.parts)
	}));
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

/** Concatenate the streamed text out of an OpenAI/Gemini SSE wire body. */
export function reconstructSse(raw: string): string {
	let out = '';
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) continue;
		const data = trimmed.slice(5).trim();
		if (!data || data === '[DONE]') continue;
		const obj = safeParse(data);
		if (!isRecord(obj)) continue;

		// OpenAI chat: choices[].delta.content
		if (Array.isArray(obj.choices)) {
			for (const ch of obj.choices) {
				if (isRecord(ch) && isRecord(ch.delta) && typeof ch.delta.content === 'string') {
					out += ch.delta.content;
				}
			}
			continue;
		}
		// OpenAI Responses: { type: 'response.output_text.delta', delta: '…' }
		if (obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
			out += obj.delta;
			continue;
		}
		// Native Gemini: candidates[].content.parts[].text
		if (Array.isArray(obj.candidates)) {
			for (const cand of obj.candidates) {
				if (isRecord(cand) && isRecord(cand.content)) {
					out += flattenContent(cand.content.parts);
				}
			}
		}
	}
	return out;
}

/** Extract the assistant's reply text from a buffered JSON response body. */
function bufferedResponseText(body: unknown): string {
	if (!isRecord(body)) return '';
	// OpenAI chat completions
	if (Array.isArray(body.choices)) {
		return body.choices
			.map((ch) => {
				if (isRecord(ch) && isRecord(ch.message)) return flattenContent(ch.message.content);
				return '';
			})
			.filter(Boolean)
			.join('\n');
	}
	// OpenAI Responses API: `output_text` convenience, else walk `output`
	if (typeof body.output_text === 'string') return body.output_text;
	if (Array.isArray(body.output)) {
		return body.output
			.map((item) => (isRecord(item) ? flattenContent(item.content) : ''))
			.filter(Boolean)
			.join('\n');
	}
	// Native Gemini
	if (Array.isArray(body.candidates)) {
		return body.candidates
			.map((cand) => (isRecord(cand) && isRecord(cand.content) ? flattenContent(cand.content.parts) : ''))
			.filter(Boolean)
			.join('\n');
	}
	return '';
}

/**
 * The assistant's reply for the conversation view: reconstructed from the SSE
 * stream when the response was streamed, else read from the buffered JSON.
 * Returns '' when nothing recognizable is present (UI falls back to raw).
 */
export function responseText(
	responseBody: string | null | undefined,
	format: string | null | undefined
): string {
	if (!responseBody) return '';
	if (format === 'sse') return reconstructSse(responseBody);
	return bufferedResponseText(safeParse(responseBody));
}

/** Pretty-print a JSON string for the raw view; returns the input unchanged if not JSON. */
export function prettyJson(text: string | null | undefined): string {
	if (!text) return '';
	const parsed = safeParse(text);
	return parsed == null ? text : JSON.stringify(parsed, null, 2);
}
