/**
 * Native Google Gemini adapter. Translates between the OpenAI surface the
 * gateway speaks and Gemini's native REST API
 * (https://ai.google.dev/gemini-api/docs#rest):
 *
 *   chat        → POST /models/{model}:generateContent (or :streamGenerateContent?alt=sse)
 *   embeddings  → POST /models/{model}:batchEmbedContents
 *   models      → GET  /models
 *
 * All exported helpers are pure so they can be unit-tested against recorded
 * payloads with no network. Auth is the `x-goog-api-key` header, applied by the
 * gateway via the provider's `google` auth scheme (see providers.ts).
 */
import type { ProviderAdapter, AdapterModel } from './types';
import type { Capability } from '$lib/scopes';
import { isRecord } from '$lib/server/json';

function num(v: unknown): number | null {
	return typeof v === 'number' ? v : null;
}

/** Flatten an OpenAI message `content` (string or content-part array) to text. */
function textOf(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content.map((p) => (isRecord(p) && typeof p.text === 'string' ? p.text : '')).join('');
	}
	return '';
}

/** OpenAI message content → Gemini `parts` (text + inline/file images). */
function partsFromContent(content: unknown): Record<string, unknown>[] {
	if (typeof content === 'string') return content ? [{ text: content }] : [];
	if (!Array.isArray(content)) return [];
	const parts: Record<string, unknown>[] = [];
	for (const p of content) {
		if (!isRecord(p)) continue;
		if (p.type === 'text' && typeof p.text === 'string') {
			parts.push({ text: p.text });
		} else if (
			p.type === 'image_url' &&
			isRecord(p.image_url) &&
			typeof p.image_url.url === 'string'
		) {
			const url = p.image_url.url;
			const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
			// data: URIs become inline base64; http(s) URLs are passed as fileData
			// (Gemini fetches some URIs itself; arbitrary ones may error upstream).
			if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
			else parts.push({ fileData: { fileUri: url } });
		}
	}
	return parts;
}

interface BuiltContents {
	systemTexts: string[];
	contents: Record<string, unknown>[];
}

/** tool_call_id → function name, learned from assistant `tool_calls`. */
type ToolCallNames = Map<string, string>;

/** Parse a tool call's JSON `arguments` string; anything empty or unparseable is `{}`. */
function parseToolArgs(args: unknown): unknown {
	if (typeof args !== 'string' || !args) return {};
	try {
		return JSON.parse(args);
	} catch {
		return {};
	}
}

/** One OpenAI assistant tool call → a Gemini `functionCall` part (null if malformed). */
function functionCallPart(tc: unknown, names: ToolCallNames): Record<string, unknown> | null {
	if (!isRecord(tc) || !isRecord(tc.function)) return null;
	const name = String(tc.function.name ?? '');
	if (tc.id != null) names.set(String(tc.id), name);
	return { functionCall: { name, args: parseToolArgs(tc.function.arguments) } };
}

/** Assistant message → a `model` content of text plus `functionCall` parts. */
function assistantContent(
	msg: Record<string, unknown>,
	names: ToolCallNames
): Record<string, unknown> | null {
	const parts: Record<string, unknown>[] = [];
	const t = textOf(msg.content);
	if (t) parts.push({ text: t });
	const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
	for (const tc of calls) {
		const part = functionCallPart(tc, names);
		if (part) parts.push(part);
	}
	return parts.length ? { role: 'model', parts } : null;
}

/** A tool result's text as a `functionResponse.response` object (non-objects are wrapped). */
function toolResponse(raw: string): Record<string, unknown> {
	let response: unknown;
	try {
		response = JSON.parse(raw);
	} catch {
		return { result: raw };
	}
	return isRecord(response) ? response : { result: response };
}

/**
 * Tool message → a `user` content carrying a `functionResponse`, named after
 * the matching assistant tool call, else `msg.name`, else the id.
 */
function toolContent(msg: Record<string, unknown>, names: ToolCallNames): Record<string, unknown> {
	const id = msg.tool_call_id != null ? String(msg.tool_call_id) : '';
	const name = names.get(id) || (msg.name != null ? String(msg.name) : id || 'function');
	const response = toolResponse(textOf(msg.content));
	return { role: 'user', parts: [{ functionResponse: { name, response } }] };
}

/** User (and any unrecognized role) message → plain/multimodal `user` content. */
function userContent(msg: Record<string, unknown>): Record<string, unknown> | null {
	const parts = partsFromContent(msg.content);
	return parts.length ? { role: 'user', parts } : null;
}

/** Non-system message → its Gemini content, or null when it has nothing to send. */
function contentFor(
	msg: Record<string, unknown>,
	names: ToolCallNames
): Record<string, unknown> | null {
	if (msg.role === 'assistant') return assistantContent(msg, names);
	if (msg.role === 'tool') return toolContent(msg, names);
	return userContent(msg);
}

/**
 * OpenAI `messages` → Gemini `contents` + collected system text. Maps roles
 * (assistant→model, system/developer→systemInstruction, tool→functionResponse)
 * and reassembles tool calls/results. Tool results are matched back to a
 * function name via the `tool_call_id` seen on a prior assistant `tool_calls`.
 */
export function toContents(messages: unknown[]): BuiltContents {
	const systemTexts: string[] = [];
	const contents: Record<string, unknown>[] = [];
	const names: ToolCallNames = new Map();

	for (const msg of messages) {
		if (!isRecord(msg)) continue;
		if (msg.role === 'system' || msg.role === 'developer') {
			const t = textOf(msg.content);
			if (t) systemTexts.push(t);
			continue;
		}
		const content = contentFor(msg, names);
		if (content) contents.push(content);
	}

	return { systemTexts, contents };
}

/** OpenAI sampling/limit params → Gemini `generationConfig`. */
function toGenerationConfig(body: Record<string, unknown>): Record<string, unknown> {
	const cfg: Record<string, unknown> = {};
	if (typeof body.temperature === 'number') cfg.temperature = body.temperature;
	if (typeof body.top_p === 'number') cfg.topP = body.top_p;
	const maxTok = body.max_completion_tokens ?? body.max_tokens;
	if (typeof maxTok === 'number') cfg.maxOutputTokens = maxTok;
	if (typeof body.n === 'number') cfg.candidateCount = body.n;
	if (typeof body.frequency_penalty === 'number') cfg.frequencyPenalty = body.frequency_penalty;
	if (typeof body.presence_penalty === 'number') cfg.presencePenalty = body.presence_penalty;
	if (typeof body.stop === 'string') cfg.stopSequences = [body.stop];
	else if (Array.isArray(body.stop)) cfg.stopSequences = body.stop;
	const rf = body.response_format;
	if (isRecord(rf)) {
		if (rf.type === 'json_object') {
			cfg.responseMimeType = 'application/json';
		} else if (
			rf.type === 'json_schema' &&
			isRecord(rf.json_schema) &&
			isRecord(rf.json_schema.schema)
		) {
			cfg.responseMimeType = 'application/json';
			cfg.responseSchema = rf.json_schema.schema;
		}
	}
	return cfg;
}

/** OpenAI `tools` → Gemini `tools: [{ functionDeclarations }]`. */
function toTools(body: Record<string, unknown>): Record<string, unknown>[] | undefined {
	if (!Array.isArray(body.tools)) return undefined;
	const decls: Record<string, unknown>[] = [];
	for (const t of body.tools) {
		if (isRecord(t) && t.type === 'function' && isRecord(t.function)) {
			const fn = t.function;
			const decl: Record<string, unknown> = { name: String(fn.name ?? '') };
			if (fn.description != null) decl.description = String(fn.description);
			if (isRecord(fn.parameters)) decl.parameters = fn.parameters;
			decls.push(decl);
		}
	}
	return decls.length ? [{ functionDeclarations: decls }] : undefined;
}

/** OpenAI `tool_choice` → Gemini `toolConfig.functionCallingConfig`. */
function toToolConfig(body: Record<string, unknown>): Record<string, unknown> | undefined {
	const tc = body.tool_choice;
	if (tc === 'none') return { functionCallingConfig: { mode: 'NONE' } };
	if (tc === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
	if (tc === 'required') return { functionCallingConfig: { mode: 'ANY' } };
	if (isRecord(tc) && tc.type === 'function' && isRecord(tc.function) && tc.function.name != null) {
		return {
			functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [String(tc.function.name)] }
		};
	}
	return undefined;
}

/** OpenAI ChatCompletion request → Gemini `generateContent` request. */
export function toGeminiChatRequest(body: unknown): Record<string, unknown> {
	if (!isRecord(body)) return { contents: [] };
	const messages = Array.isArray(body.messages) ? body.messages : [];
	const { systemTexts, contents } = toContents(messages);
	const req: Record<string, unknown> = { contents };
	if (systemTexts.length) req.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
	const gen = toGenerationConfig(body);
	if (Object.keys(gen).length) req.generationConfig = gen;
	const tools = toTools(body);
	if (tools) req.tools = tools;
	const toolCfg = toToolConfig(body);
	if (toolCfg) req.toolConfig = toolCfg;
	return req;
}

/** OpenAI embeddings request → Gemini `batchEmbedContents` request. */
export function toGeminiEmbedRequest(body: unknown, model: string): Record<string, unknown> {
	const input = isRecord(body) ? body.input : undefined;
	const inputs = Array.isArray(input) ? input : [input];
	const dims = isRecord(body) && typeof body.dimensions === 'number' ? body.dimensions : undefined;
	const requests = inputs.map((text) => {
		const req: Record<string, unknown> = {
			model: `models/${model}`,
			content: { parts: [{ text: String(text ?? '') }] }
		};
		if (dims != null) req.outputDimensionality = dims;
		return req;
	});
	return { requests };
}

/** Gemini `finishReason` → OpenAI `finish_reason` (tool calls win when present). */
export function mapFinishReason(reason: unknown, hasToolCall: boolean): string | null {
	if (hasToolCall) return 'tool_calls';
	switch (reason) {
		case 'MAX_TOKENS':
			return 'length';
		case 'SAFETY':
		case 'RECITATION':
		case 'BLOCKLIST':
		case 'PROHIBITED_CONTENT':
		case 'SPII':
			return 'content_filter';
		case 'STOP':
			return 'stop';
		default:
			return reason ? 'stop' : null;
	}
}

/** Gemini `usageMetadata` → OpenAI `usage` (thoughts count as output tokens). */
export function mapUsage(u: unknown): Record<string, unknown> | undefined {
	if (!isRecord(u)) return undefined;
	const prompt = num(u.promptTokenCount) ?? 0;
	const completion = (num(u.candidatesTokenCount) ?? 0) + (num(u.thoughtsTokenCount) ?? 0);
	const cached = num(u.cachedContentTokenCount);
	const usage: Record<string, unknown> = {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: num(u.totalTokenCount) ?? prompt + completion
	};
	// Gemini's promptTokenCount already includes the cached subset, matching
	// OpenAI's prompt_tokens/cached_tokens relationship the cost calc expects.
	if (cached != null) usage.prompt_tokens_details = { cached_tokens: cached };
	return usage;
}

/** A Gemini `functionCall` → the OpenAI `tool_calls` entry (`id`, `type`, `function`). */
function toolCallOf(i: number, fc: Record<string, unknown>): Record<string, unknown> {
	return {
		id: `call_${i}`,
		type: 'function',
		function: { name: String(fc.name ?? ''), arguments: JSON.stringify(fc.args ?? {}) }
	};
}

/** Extract text + tool calls from a Gemini candidate's content parts. */
function readParts(parts: unknown[]): { text: string; toolCalls: Record<string, unknown>[] } {
	let text = '';
	const toolCalls: Record<string, unknown>[] = [];
	for (const p of parts) {
		if (!isRecord(p)) continue;
		if (typeof p.text === 'string') {
			text += p.text;
		} else if (isRecord(p.functionCall)) {
			toolCalls.push(toolCallOf(toolCalls.length, p.functionCall));
		}
	}
	return { text, toolCalls };
}

/** Gemini `generateContent` response → OpenAI ChatCompletion. */
export function fromGeminiChatResponse(model: string, g: unknown): Record<string, unknown> {
	const candidates = isRecord(g) && Array.isArray(g.candidates) ? g.candidates : [];
	const choices = candidates.map((c, i) => {
		const parts =
			isRecord(c) && isRecord(c.content) && Array.isArray(c.content.parts) ? c.content.parts : [];
		const { text, toolCalls } = readParts(parts);
		const message: Record<string, unknown> = {
			role: 'assistant',
			content: toolCalls.length && !text ? null : text
		};
		if (toolCalls.length) message.tool_calls = toolCalls;
		return {
			index: isRecord(c) && typeof c.index === 'number' ? c.index : i,
			message,
			finish_reason: mapFinishReason(isRecord(c) ? c.finishReason : undefined, toolCalls.length > 0)
		};
	});
	const out: Record<string, unknown> = {
		id: isRecord(g) && typeof g.responseId === 'string' ? g.responseId : `chatcmpl-${Date.now()}`,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices
	};
	const usage = mapUsage(isRecord(g) ? g.usageMetadata : undefined);
	if (usage) out.usage = usage;
	return out;
}

/** Gemini `batchEmbedContents` response → OpenAI embeddings list. */
export function fromGeminiEmbedResponse(model: string, g: unknown): Record<string, unknown> {
	const embs = isRecord(g) && Array.isArray(g.embeddings) ? g.embeddings : [];
	const data = embs.map((e, i) => ({
		object: 'embedding',
		index: i,
		embedding: isRecord(e) && Array.isArray(e.values) ? e.values : []
	}));
	const prompt =
		isRecord(g) && isRecord(g.usageMetadata) ? (num(g.usageMetadata.promptTokenCount) ?? 0) : 0;
	return {
		object: 'list',
		data,
		model,
		usage: { prompt_tokens: prompt, total_tokens: prompt }
	};
}

/** Wrap a native Gemini error body in an OpenAI error envelope. */
function fromGeminiError(text: string): string {
	let message = 'Upstream provider error';
	try {
		const j = JSON.parse(text);
		if (isRecord(j) && isRecord(j.error) && typeof j.error.message === 'string') {
			message = j.error.message;
		}
	} catch {
		// keep the generic message for non-JSON bodies
	}
	return JSON.stringify({ error: { message, type: 'api_error', code: null, param: null } });
}

/** Translation state carried across the events of one stream. */
interface StreamState {
	/** the first delta carries `role: 'assistant'` */
	roleSent: boolean;
	/** tool calls are numbered across the whole stream */
	toolIndex: number;
}

/** One OpenAI chunk payload: its `choices` and, for the trailing chunk, `usage`. */
interface StreamChunk {
	choices: unknown[];
	usage?: Record<string, unknown>;
}

function textDelta(state: StreamState, text: string): Record<string, unknown> {
	const delta = state.roleSent ? { content: text } : { role: 'assistant', content: text };
	state.roleSent = true;
	return delta;
}

function toolCallDelta(state: StreamState, fc: Record<string, unknown>): Record<string, unknown> {
	const delta: Record<string, unknown> = {
		tool_calls: [{ index: state.toolIndex, ...toolCallOf(state.toolIndex, fc) }]
	};
	if (!state.roleSent) delta.role = 'assistant';
	state.roleSent = true;
	state.toolIndex++;
	return delta;
}

/** The delta for one streamed part (non-empty text or a functionCall), else null. */
function partDelta(
	state: StreamState,
	p: unknown
): { delta: Record<string, unknown>; tool: boolean } | null {
	if (!isRecord(p)) return null;
	if (typeof p.text === 'string' && p.text) return { delta: textDelta(state, p.text), tool: false };
	if (isRecord(p.functionCall)) return { delta: toolCallDelta(state, p.functionCall), tool: true };
	return null;
}

/** One candidate → its part deltas, then a finish chunk when it carries a finishReason. */
function candidateChunks(state: StreamState, c: Record<string, unknown>): StreamChunk[] {
	const parts = isRecord(c.content) && Array.isArray(c.content.parts) ? c.content.parts : [];
	const index = typeof c.index === 'number' ? c.index : 0;
	const chunks: StreamChunk[] = [];
	let hasTool = false;
	for (const p of parts) {
		const d = partDelta(state, p);
		if (!d) continue;
		hasTool ||= d.tool;
		chunks.push({ choices: [{ index, delta: d.delta, finish_reason: null }] });
	}
	if (c.finishReason) {
		const finish_reason = mapFinishReason(c.finishReason, hasTool);
		chunks.push({ choices: [{ index, delta: {}, finish_reason }] });
	}
	return chunks;
}

/** One native SSE event payload → the OpenAI chunks it translates to (none for junk). */
function streamEventChunks(payload: string, state: StreamState): StreamChunk[] {
	if (payload === '[DONE]') return [];
	let g: unknown;
	try {
		g = JSON.parse(payload);
	} catch {
		return [];
	}
	const candidates = isRecord(g) && Array.isArray(g.candidates) ? g.candidates : [];
	const chunks = candidates.filter(isRecord).flatMap((c) => candidateChunks(state, c));
	const usage = mapUsage(isRecord(g) ? g.usageMetadata : undefined);
	if (usage) chunks.push({ choices: [], usage });
	return chunks;
}

/**
 * Transform a Gemini `streamGenerateContent?alt=sse` body into OpenAI
 * `chat.completion.chunk` SSE: a role delta, content/tool-call deltas, a
 * finish_reason chunk, a trailing usage chunk, and `[DONE]`.
 */
export function streamGeminiToOpenAi(
	model: string,
	source: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
	const id = `chatcmpl-${Date.now()}`;
	const created = Math.floor(Date.now() / 1000);
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const reader = source.getReader();
	let buffer = '';
	let dataLines: string[] = [];
	const state: StreamState = { roleSent: false, toolIndex: 0 };

	const emit = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		choices: unknown[],
		usage?: Record<string, unknown>
	) => {
		const obj: Record<string, unknown> = {
			id,
			object: 'chat.completion.chunk',
			created,
			model,
			choices
		};
		if (usage) obj.usage = usage;
		controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
	};

	const flush = (controller: ReadableStreamDefaultController<Uint8Array>) => {
		if (!dataLines.length) return;
		const payload = dataLines.join('\n');
		dataLines = [];
		for (const chunk of streamEventChunks(payload, state)) {
			emit(controller, chunk.choices, chunk.usage);
		}
	};

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let nl: number;
					while ((nl = buffer.indexOf('\n')) !== -1) {
						let line = buffer.slice(0, nl);
						buffer = buffer.slice(nl + 1);
						if (line.endsWith('\r')) line = line.slice(0, -1);
						if (line === '') {
							flush(controller); // blank line terminates an SSE event
						} else if (line.startsWith('data:')) {
							dataLines.push(line.slice(5).replace(/^ /, ''));
						}
						// other SSE fields (event:, id:, : comments) are ignored
					}
				}
				if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).replace(/^ /, ''));
				flush(controller);
				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				controller.close();
			} catch {
				// upstream aborted mid-stream — close out what we have
				try {
					controller.close();
				} catch {
					// already closed
				}
			} finally {
				reader.releaseLock();
			}
		},
		// the client went away: stop reading and abort the upstream Gemini stream
		// instead of draining it to completion in the background
		async cancel(reason) {
			await reader.cancel(reason).catch(() => {});
		}
	});
}

export const geminiAdapter: ProviderAdapter = {
	buildUrl({ baseUrl, scope, model, stream }) {
		if (scope === 'embeddings') return `${baseUrl}/models/${model}:batchEmbedContents`;
		return stream
			? `${baseUrl}/models/${model}:streamGenerateContent?alt=sse`
			: `${baseUrl}/models/${model}:generateContent`;
	},
	translateRequest(scope: Capability, body: unknown) {
		return scope === 'embeddings'
			? toGeminiEmbedRequest(body, modelFromEmbedBody(body))
			: toGeminiChatRequest(body);
	},
	translateResponse({ scope, model, text, ok }) {
		if (!ok) return fromGeminiError(text);
		let g: unknown;
		try {
			g = JSON.parse(text);
		} catch {
			return text;
		}
		return JSON.stringify(
			scope === 'embeddings' ? fromGeminiEmbedResponse(model, g) : fromGeminiChatResponse(model, g)
		);
	},
	translateStream({ model }, body) {
		return streamGeminiToOpenAi(model, body);
	},
	modelsUrl(baseUrl) {
		return `${baseUrl}/models?pageSize=1000`;
	},
	translateModels(text) {
		let j: unknown;
		try {
			j = JSON.parse(text);
		} catch {
			return [];
		}
		const models = isRecord(j) && Array.isArray(j.models) ? j.models : [];
		const out: AdapterModel[] = [];
		for (const m of models) {
			if (isRecord(m) && typeof m.name === 'string') {
				out.push({ id: m.name.replace(/^models\//, '') });
			}
		}
		return out;
	}
};

/** The embedding model id, read from the request body (the URL carries it too). */
function modelFromEmbedBody(body: unknown): string {
	return isRecord(body) && typeof body.model === 'string' ? body.model : '';
}

/**
 * Parse a native Gemini path segment of the form `{model}:{method}` (as the
 * Google GenAI SDK sends, e.g. `gemini-2.5-flash:generateContent`) into the
 * model, the method, and the gateway scope/stream it maps to. Returns null for
 * an unsupported method so the route can reject it. Used by the native-ingress
 * route; pure and unit-tested.
 */
export function parseGeminiAction(
	segment: string
): { model: string; method: string; scope: Capability; stream: boolean } | null {
	const idx = segment.lastIndexOf(':');
	if (idx <= 0) return null;
	const model = segment.slice(0, idx);
	const method = segment.slice(idx + 1);
	switch (method) {
		case 'generateContent':
			return { model, method, scope: 'chat', stream: false };
		case 'streamGenerateContent':
			return { model, method, scope: 'chat', stream: true };
		// countTokens is a free pre-flight estimator; it scopes as chat (so policy
		// applies) but reports no usageMetadata, so it's simply never billed.
		case 'countTokens':
			return { model, method, scope: 'chat', stream: false };
		case 'embedContent':
		case 'batchEmbedContents':
			return { model, method, scope: 'embeddings', stream: false };
		default:
			return null;
	}
}
