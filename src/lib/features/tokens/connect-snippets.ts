/**
 * Copy-paste snippets that show where a machine token goes, per client shape.
 * Pure so the dialog stays dumb and the strings are testable.
 */

export type ConnectSnippet = {
	id: string;
	label: string;
	/** one line: when to pick this surface */
	when: string;
	/** what to put in the client's base URL / endpoint setting */
	baseUrl: string;
	code: string;
};

export function connectSnippets(origin: string, token: string): ConnectSnippet[] {
	const v1 = `${origin}/v1`;
	return [
		{
			id: 'responses',
			label: 'Responses',
			when: 'OpenAI Responses API: the default for new OpenAI code (tools, reasoning, state).',
			baseUrl: v1,
			code: `curl ${v1}/responses \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.4-mini","input":"Hello"}'`
		},
		{
			id: 'chat',
			label: 'Chat',
			when: 'Widest compatibility: works with gpt-*, claude-* and gemini-* models alike.',
			baseUrl: v1,
			code: `curl ${v1}/chat/completions \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.4-mini","messages":[{"role":"user","content":"Hello"}]}'`
		},
		{
			id: 'openai-sdk',
			label: 'OpenAI SDK',
			when: 'Any OpenAI SDK or OpenAI-compatible tool: swap base URL and key.',
			baseUrl: v1,
			code: `import OpenAI from 'openai';

const client = new OpenAI({
	apiKey: '${token}',
	baseURL: '${v1}'
});

await client.responses.create({ model: 'gpt-5.4-mini', input: 'Hello' });`
		},
		{
			id: 'azure',
			label: 'Azure',
			when: 'Existing Azure OpenAI clients: the endpoint is the uprox origin, deployment = model.',
			baseUrl: origin,
			code: `import { AzureOpenAI } from 'openai';

const client = new AzureOpenAI({
	endpoint: '${origin}',
	apiKey: '${token}',
	apiVersion: '2024-10-21',
	deployment: 'gpt-5.4-mini'
});`
		},
		{
			id: 'gemini',
			label: 'Gemini',
			when: 'Native @google/genai client, keeps Gemini-only fields. /v1beta is required.',
			baseUrl: `${origin}/v1beta`,
			code: `import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
	apiKey: '${token}',
	httpOptions: { baseUrl: '${origin}/v1beta' }
});

await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'Hello' });`
		}
	];
}
