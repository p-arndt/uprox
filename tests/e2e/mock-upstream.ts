/**
 * A stand-in for an upstream LLM provider, so gateway and provider tests never
 * touch the public internet. It speaks the OpenAI-compatible surface the gateway
 * proxies (model listing and chat completions, buffered and SSE) and is
 * registered in uprox as an Ollama endpoint: Ollama is the only provider whose
 * endpoint may be plain http, and its optional basic auth lets the mock tell a
 * good credential from a bad one without any state.
 *
 * Used as Playwright `globalSetup`: it runs in the runner process after the web
 * server booted, and the returned function stops the mock again.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

// Offset from the preview port so parallel runs (E2E_PORT per worktree) get
// their own mock without extra configuration.
export const MOCK_PORT = Number(
	process.env.E2E_MOCK_PORT ?? Number(process.env.E2E_PORT ?? 4173) + 100
);
/** What an operator types into the Ollama "Endpoint URL" field; uprox appends /v1. */
export const MOCK_ENDPOINT = `http://127.0.0.1:${MOCK_PORT}`;

export const MOCK_USERNAME = 'uprox';
/** Ends in "beef" so the dashboard's masked hint is predictable (••••beef). */
export const MOCK_PASSWORD = 'mock-secret-beef';
export const MOCK_MODEL = 'mock-llama';

/** The reply text the mock sends for a prompt; tests assert on it. */
export function mockReply(prompt: string): string {
	return `mock reply to: ${prompt}`;
}

const EXPECTED_AUTH = `Basic ${Buffer.from(`${MOCK_USERNAME}:${MOCK_PASSWORD}`).toString('base64')}`;

function sendJson(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	try {
		const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function lastUserMessage(body: Record<string, unknown>): string {
	const messages = Array.isArray(body.messages) ? body.messages : [];
	const last = messages.filter((m) => m && m.role === 'user').at(-1);
	return typeof last?.content === 'string' ? last.content : '';
}

async function handle(req: IncomingMessage, res: ServerResponse) {
	const path = new URL(req.url ?? '/', MOCK_ENDPOINT).pathname;

	// shaped like OpenAI's error so the connection test can surface the message
	if (req.headers.authorization !== EXPECTED_AUTH) {
		return sendJson(res, 401, {
			error: { message: 'Incorrect API key provided', type: 'invalid_request_error' }
		});
	}

	if (req.method === 'GET' && path === '/v1/models') {
		return sendJson(res, 200, {
			object: 'list',
			data: [{ id: MOCK_MODEL, object: 'model', created: 1_700_000_000, owned_by: 'mock' }]
		});
	}

	if (req.method === 'POST' && path === '/v1/chat/completions') {
		const body = await readJson(req);
		const model = typeof body.model === 'string' ? body.model : MOCK_MODEL;
		const content = mockReply(lastUserMessage(body));
		const usage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 };
		const id = `chatcmpl-mock-${Date.now()}`;
		const created = Math.floor(Date.now() / 1000);

		if (body.stream === true) {
			res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
			const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
				id,
				object: 'chat.completion.chunk',
				created,
				model,
				choices: [{ index: 0, delta, finish_reason: finish }]
			});
			const events: unknown[] = [
				chunk({ role: 'assistant', content: '' }, null),
				chunk({ content }, null),
				chunk({}, 'stop')
			];
			const options = body.stream_options as { include_usage?: boolean } | undefined;
			if (options?.include_usage) {
				events.push({ id, object: 'chat.completion.chunk', created, model, choices: [], usage });
			}
			for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
			res.end('data: [DONE]\n\n');
			return;
		}

		return sendJson(res, 200, {
			id,
			object: 'chat.completion',
			created,
			model,
			choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
			usage
		});
	}

	sendJson(res, 404, { error: { message: `mock upstream has no route ${req.method} ${path}` } });
}

export default async function startMockUpstream(): Promise<() => Promise<void>> {
	const server = createServer((req, res) => {
		handle(req, res).catch((err: unknown) => {
			sendJson(res, 500, { error: { message: String(err) } });
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(MOCK_PORT, '127.0.0.1', resolve);
	});
	console.log(`[e2e] mock upstream listening on ${MOCK_ENDPOINT}`);
	return () =>
		new Promise<void>((resolve) => {
			server.closeAllConnections();
			server.close(() => resolve());
		});
}
