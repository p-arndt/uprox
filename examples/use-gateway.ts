/**
 * Minimal example: call the uprox gateway with the official OpenAI SDK.
 *
 * The only changes vs. talking to OpenAI directly:
 *   - apiKey  → your uprox machine token (uprox_live_…)
 *   - baseURL → your uprox instance + /v1
 *
 * uprox validates the token, enforces policy, swaps in the org's real
 * provider key, proxies the request, and records it in the audit log.
 *
 * Run:
 *   pnpm add -D openai tsx
 *   UPROX_TOKEN=uprox_live_… pnpm tsx examples/use-gateway.ts
 */
import OpenAI from 'openai';

const client = new OpenAI({
	apiKey: process.env.UPROX_TOKEN || 'uprox_live_REPLACE_ME',
	baseURL: process.env.UPROX_URL || 'http://localhost:5173/v1'
});

async function main() {
	// 1. List the models your token's policy allows (aggregated across providers).
	// const models = await client.models.list();
	// console.log(
	// 	'Available models:',
	// 	models.data.map((m) => m.id).join(', ') || '(none — configure a provider key first)'
	// );

	// 2. A normal chat completion. Model routing is automatic:
	//    gpt-* → OpenAI, claude-* → Anthropic.
	const completion = await client.chat.completions.create({
		model: 'gpt-5.4-nano',
		messages: [
			{ role: 'system', content: 'You are concise.' },
			{ role: 'user', content: 'In one sentence: what is an identity gateway?' }
		]
	});
	console.log('\nResponse:', completion.choices[0]?.message.content);

	// 3. The same call, streamed. uprox passes the SSE stream straight through.
	console.log('\nStreaming:');
	const stream = await client.chat.completions.create({
		model: 'gpt-5.4-nano',
		messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
		stream: true
	});
	for await (const chunk of stream) {
		process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
	}
	console.log('\n');

	// 4. The newer Responses API. Same auth, policy, and audit path — only the
	//    OpenAI provider implements it, so this must be a gpt-*/o* model.
	//    (A claude-* model here is rejected with a clear 400 by the gateway.)
	const response = await client.responses.create({
		model: 'gpt-5.4-nano',
		input: 'In one sentence: what is an identity gateway?'
	});
	console.log('Responses API:', response.output_text);

	// 5. The Responses API, streamed. uprox passes the SSE events straight through.
	console.log('\nResponses API (streaming):');
	const responseStream = await client.responses.create({
		model: 'gpt-5.4-nano',
		input: 'Count from 1 to 5.',
		stream: true
	});
	for await (const event of responseStream) {
		if (event.type === 'response.output_text.delta') process.stdout.write(event.delta);
	}
	console.log('\n');
}

main().catch((err) => {
	// Gateway errors come back in OpenAI's error shape, so the SDK throws them.
	// e.g. 401 invalid token, 403 denied by policy, 502 no provider key configured.
	console.error('Request failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
