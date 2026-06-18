/**
 * Minimal example: call the uprox gateway with Google's official GenAI SDK.
 *
 * uprox exposes a *native* Gemini ingress, so the only changes vs. talking to
 * Google directly are:
 *   - apiKey  → your uprox machine token (uprox_live_…); the SDK sends it as the
 *               `x-goog-api-key` header, which uprox authenticates.
 *   - baseUrl → your uprox instance origin PLUS `/v1beta`.
 *
 * IMPORTANT — the #1 cause of a 404 here:
 *   When you set `httpOptions.baseUrl`, the SDK uses it verbatim and just appends
 *   `/models/{model}:{method}` — it does NOT re-add the `v1beta` version segment.
 *   uprox serves the route at `/v1beta/models/{model}:{method}`, so the version
 *   has to be in your baseUrl:
 *     ✅  baseUrl: 'http://localhost:5173/v1beta'   → POST /v1beta/models/…  (matches)
 *     ❌  baseUrl: 'http://localhost:5173'          → POST /models/…         (404, HTML page)
 *   The HTML 404 body you saw is SvelteKit's fallback page — the request never
 *   reached the gateway route because the path was missing `/v1beta`.
 *
 * uprox validates the token, enforces policy/budget, swaps in the org's real
 * Google key, proxies the native request straight through (no translation, so
 * native-only features survive), and records it in the audit log.
 *
 * Run:
 *   pnpm add -D @google/genai tsx
 *   UPROX_TOKEN=uprox_live_… pnpm tsx examples/use-gateway-gemini.ts
 */
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
	apiKey: process.env.UPROX_TOKEN || 'uprox_live_REPLACE_ME',
	httpOptions: {
		// Must include /v1beta — the SDK appends /models/… to this verbatim and
		// does not add the version itself (see the note above).
		baseUrl: process.env.UPROX_URL || 'http://localhost:5173/v1beta'
	}
});

const MODEL = process.env.UPROX_GEMINI_MODEL || 'gemini-2.5-flash';

async function main() {
	// 1. List the models your token's policy allows. (SDK → GET /v1beta/models)
	console.log('Available models:');
	for await (const m of await ai.models.list()) {
		console.log('  -', m.name);
	}

	// 2. A normal generate. (SDK → POST /v1beta/models/{model}:generateContent)
	const res = await ai.models.generateContent({
		model: MODEL,
		contents: 'In one sentence: what is an identity gateway?',
		config: { systemInstruction: 'You are concise.' }
	});
	console.log('\nResponse:', res.text);

	// 3. countTokens — a free pre-flight estimator, never billed by uprox.
	//    (SDK → POST /v1beta/models/{model}:countTokens)
	const count = await ai.models.countTokens({
		model: MODEL,
		contents: 'How many tokens is this?'
	});
	console.log('Token count:', count.totalTokens);

	// 4. Streaming. (SDK → POST /v1beta/models/{model}:streamGenerateContent?alt=sse)
	//    uprox passes the SSE stream straight through.
	console.log('\nStreaming:');
	const stream = await ai.models.generateContentStream({
		model: MODEL,
		contents: 'Count from 1 to 5.'
	});
	for await (const chunk of stream) {
		process.stdout.write(chunk.text ?? '');
	}
	console.log('\n');
}

main().catch((err) => {
	// Gateway errors come back in Gemini's native { error: { code, message, status } }
	// shape, so the SDK throws them. e.g. 401 invalid token, 403 denied by policy,
	// 502 no provider key configured.
	console.error('Request failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
