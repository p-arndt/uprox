/**
 * Minimal example: call the uprox gateway with the official OpenAI SDK.
 *
 * The only changes vs. talking to OpenAI directly:
 *   - apiKey  → your uprox machine token (uprox_live_…)
 *   - baseURL → your uprox instance + /v1
 *
 * uprox validates the token, enforces policy, swaps in the org's real provider
 * key, proxies the request, records it in the audit log, and — when tracing is
 * enabled — captures the prompt/response for the in-app trace viewer.
 *
 * This example also sets an `x-uprox-trace-id` header (a per-run session id) on
 * every call, so the whole run — including the multi-step tool-use loop below —
 * shows up as ONE grouped session in the Traces view.
 *
 * Run:
 *   pnpm add -D openai tsx
 *   UPROX_TOKEN=uprox_live_… pnpm tsx examples/use-gateway.ts
 */
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';

// One id for this whole run; uprox groups every traced call under it.
const sessionId = randomUUID();

const client = new OpenAI({
	apiKey: process.env.UPROX_TOKEN || 'uprox_live_REPLACE_ME',
	baseURL: process.env.UPROX_URL || 'http://localhost:5173/v1',
	defaultHeaders: {
		// all calls share one trace session…
		'x-uprox-trace-id': sessionId,
		// …and carry free-form metadata (anything you like — chat id, user, tenant, tags).
		'x-uprox-metadata': JSON.stringify({ chat_id: sessionId, user_id: 'demo-user' })
	}
});

const MODEL = process.env.UPROX_MODEL || 'gpt-5.4-nano';

async function main() {
	console.log('Trace session id:', sessionId, '\n');

	// 1. A normal chat completion. Model routing is automatic:
	//    gpt-* → OpenAI, claude-* → Anthropic.
	const completion = await client.chat.completions.create({
		model: MODEL,
		messages: [
			{ role: 'system', content: 'You are concise.' },
			{ role: 'user', content: 'In one sentence: what is an identity gateway?' }
		]
	});
	console.log('Response:', completion.choices[0]?.message.content);

	// 2. Tool use (function calling). The model decides to call our tool; we run
	//    it, feed the result back, and it produces the final answer. Both round
	//    trips are separate gateway calls — in the trace viewer they appear as two
	//    spans under this run's session, with the tool call and result rendered.
	await toolUseRoundTrip();

	// // 3. The same chat call, streamed. uprox passes the SSE stream straight through.
	// console.log('\nStreaming:');
	// const stream = await client.chat.completions.create({
	// 	model: MODEL,
	// 	messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
	// 	stream: true
	// });
	// for await (const chunk of stream) {
	// 	process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
	// }
	// console.log('\n');

	// console.log('\nDone. Open the Traces view and filter by session', sessionId);
}

/** A toy tool the model can call. In a real app this would hit a weather API. */
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: 'get_weather',
			description: 'Get the current weather for a city.',
			parameters: {
				type: 'object',
				properties: {
					city: { type: 'string', description: 'City name, e.g. "Berlin"' }
				},
				required: ['city']
			}
		}
	}
];

function runTool(name: string, args: string): string {
	if (name === 'get_weather') {
		const { city } = JSON.parse(args) as { city: string };
		// canned result — the point is the round-trip, not real weather
		return JSON.stringify({ city, tempC: 21, condition: 'sunny' });
	}
	return JSON.stringify({ error: `unknown tool ${name}` });
}

async function toolUseRoundTrip() {
	console.log('\nTool use:');
	const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
		{ role: 'user', content: "What's the weather in Berlin? Answer in one short sentence." }
	];

	// First call: the model chooses to invoke the tool.
	const first = await client.chat.completions.create({
		model: MODEL,
		messages,
		tools: TOOLS
	});
	const choice = first.choices[0]?.message;
	const calls = choice?.tool_calls ?? [];
	if (calls.length === 0) {
		console.log('(model answered without calling a tool):', choice?.content);
		return;
	}

	// Echo the assistant's tool-call turn back, then append each tool result.
	messages.push(choice!);
	for (const call of calls) {
		if (call.type !== 'function') continue;
		const result = runTool(call.function.name, call.function.arguments);
		console.log(`  → ${call.function.name}(${call.function.arguments}) = ${result}`);
		messages.push({ role: 'tool', tool_call_id: call.id, content: result });
	}

	// Second call: the model uses the tool result to produce the final answer.
	const second = await client.chat.completions.create({ model: MODEL, messages, tools: TOOLS });
	console.log('  Final:', second.choices[0]?.message.content);
}

main().catch((err) => {
	// Gateway errors come back in OpenAI's error shape, so the SDK throws them.
	// e.g. 401 invalid token, 403 denied by policy, 502 no provider key configured.
	console.error('Request failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
