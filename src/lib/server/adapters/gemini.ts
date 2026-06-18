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

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
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

/**
 * OpenAI `messages` → Gemini `contents` + collected system text. Maps roles
 * (assistant→model, system/developer→systemInstruction, tool→functionResponse)
 * and reassembles tool calls/results. Tool results are matched back to a
 * function name via the `tool_call_id` seen on a prior assistant `tool_calls`.
 */
export function toContents(messages: unknown[]): BuiltContents {
	const systemTexts: string[] = [];
	const contents: Record<string, unknown>[] = [];
	const toolCallNames = new Map<string, string>();

	for (const msg of messages) {
		if (!isRecord(msg)) continue;
		const role = msg.role;

		if (role === 'system' || role === 'developer') {
			const t = textOf(msg.content);
			if (t) systemTexts.push(t);
			continue;
		}

		if (role === 'assistant') {
			const parts: Record<string, unknown>[] = [];
			const t = textOf(msg.content);
			if (t) parts.push({ text: t });
			if (Array.isArray(msg.tool_calls)) {
				for (const tc of msg.tool_calls) {
					if (!isRecord(tc) || !isRecord(tc.function)) continue;
					const name = String(tc.function.name ?? '');
					if (tc.id != null) toolCallNames.set(String(tc.id), name);
					let args: unknown;
					try {
						args =
							typeof tc.function.arguments === 'string' && tc.function.arguments
								? JSON.parse(tc.function.arguments)
								: {};
					} catch {
						args = {};
					}
					parts.push({ functionCall: { name, args } });
				}
			}
			if (parts.length) contents.push({ role: 'model', parts });
			continue;
		}

		if (role === 'tool') {
			const id = msg.tool_call_id != null ? String(msg.tool_call_id) : '';
			const name =
				toolCallNames.get(id) || (msg.name != null ? String(msg.name) : id || 'function');
			const raw = textOf(msg.content);
			let response: unknown;
			try {
				response = JSON.parse(raw);
			} catch {
				response = { result: raw };
			}
			if (!isRecord(response)) response = { result: response };
			contents.push({ role: 'user', parts: [{ functionResponse: { name, response } }] });
			continue;
		}

		// user (and any unrecognized role) — plain/multimodal content
		const parts = partsFromContent(msg.content);
		if (parts.length) contents.push({ role: 'user', parts });
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

/** Extract text + tool calls from a Gemini candidate's content parts. */
function readParts(parts: unknown[]): { text: string; toolCalls: Record<string, unknown>[] } {
	let text = '';
	const toolCalls: Record<string, unknown>[] = [];
	for (const p of parts) {
		if (!isRecord(p)) continue;
		if (typeof p.text === 'string') {
			text += p.text;
		} else if (isRecord(p.functionCall)) {
			const i = toolCalls.length;
			toolCalls.push({
				id: `call_${i}`,
				type: 'function',
				function: {
					name: String(p.functionCall.name ?? ''),
					arguments: JSON.stringify(p.functionCall.args ?? {})
				}
			});
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
	let roleSent = false;
	let toolIndex = 0;

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
		if (payload === '[DONE]') return;
		let g: unknown;
		try {
			g = JSON.parse(payload);
		} catch {
			return;
		}
		const candidates = isRecord(g) && Array.isArray(g.candidates) ? g.candidates : [];
		for (const c of candidates) {
			if (!isRecord(c)) continue;
			const parts = isRecord(c.content) && Array.isArray(c.content.parts) ? c.content.parts : [];
			const index = typeof c.index === 'number' ? c.index : 0;
			let chunkHasTool = false;
			for (const p of parts) {
				if (!isRecord(p)) continue;
				if (typeof p.text === 'string' && p.text) {
					const delta: Record<string, unknown> = roleSent
						? { content: p.text }
						: { role: 'assistant', content: p.text };
					roleSent = true;
					emit(controller, [{ index, delta, finish_reason: null }]);
				} else if (isRecord(p.functionCall)) {
					chunkHasTool = true;
					const delta: Record<string, unknown> = {
						tool_calls: [
							{
								index: toolIndex,
								id: `call_${toolIndex}`,
								type: 'function',
								function: {
									name: String(p.functionCall.name ?? ''),
									arguments: JSON.stringify(p.functionCall.args ?? {})
								}
							}
						]
					};
					if (!roleSent) delta.role = 'assistant';
					roleSent = true;
					toolIndex++;
					emit(controller, [{ index, delta, finish_reason: null }]);
				}
			}
			if (c.finishReason) {
				emit(controller, [
					{ index, delta: {}, finish_reason: mapFinishReason(c.finishReason, chunkHasTool) }
				]);
			}
		}
		const usage = mapUsage(isRecord(g) ? g.usageMetadata : undefined);
		if (usage) emit(controller, [], usage);
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
