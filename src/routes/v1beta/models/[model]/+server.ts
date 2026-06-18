import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateGateway, proxyGeminiNative } from '$lib/server/gateway';
import { parseGeminiAction } from '$lib/server/adapters/gemini';

/**
 * Native Google Gemini ingress. The `@google/genai` SDK pointed at uprox calls
 * `POST /v1beta/models/{model}:{method}` (e.g. `gemini-2.5-flash:generateContent`,
 * `:streamGenerateContent`, `:embedContent`, `:batchEmbedContents`) with the
 * `x-goog-api-key` header carrying the uprox token. We parse the model/method,
 * enforce policy/budget/cost/cache, and pass the native body straight through to
 * Gemini — no translation, so native-only features survive. Errors come back in
 * the native `{ error: { code, message, status } }` shape the SDK expects.
 */
const nativeError = (status: number, message: string, googleStatus: string) =>
	json({ error: { code: status, message, status: googleStatus } }, { status });

export const POST: RequestHandler = async (event) => {
	const auth = await authenticateGateway(event);
	if (!auth.ok) {
		// re-wrap the gateway's OpenAI-shaped 401 as a native error for the SDK
		return nativeError(401, 'Missing or invalid API key', 'UNAUTHENTICATED');
	}

	// `params.model` is the whole `{model}:{method}` segment (colons are valid
	// path chars, so SvelteKit hands it over intact).
	const action = parseGeminiAction(event.params.model ?? '');
	if (!action) {
		return nativeError(
			400,
			`Unsupported Gemini method in "${event.params.model}". Supported: generateContent, streamGenerateContent, embedContent, batchEmbedContents.`,
			'INVALID_ARGUMENT'
		);
	}

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		return nativeError(400, 'Request body must be valid JSON', 'INVALID_ARGUMENT');
	}

	return proxyGeminiNative(event, {
		auth: auth.auth,
		scope: action.scope,
		model: action.model,
		method: action.method,
		stream: action.stream,
		body
	});
};
