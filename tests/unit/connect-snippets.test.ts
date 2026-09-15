import { describe, expect, it } from 'vitest';
import { connectSnippets } from '$lib/features/tokens/connect-snippets';

const origin = 'https://uprox.example.com';
const token = 'uprox_live_abc';

describe('connectSnippets', () => {
	const snippets = connectSnippets(origin, token);
	const byId = Object.fromEntries(snippets.map((s) => [s.id, s]));

	it('puts the token into every snippet', () => {
		for (const s of snippets) expect(s.code).toContain(token);
	});

	it('points each client at the base URL it expects', () => {
		expect(byId.responses?.code).toContain(`${origin}/v1/responses`);
		expect(byId.chat?.code).toContain(`${origin}/v1/chat/completions`);
		expect(byId['openai-sdk']?.baseUrl).toBe(`${origin}/v1`);
		expect(byId.azure?.baseUrl).toBe(origin);
		expect(byId.gemini?.baseUrl).toBe(`${origin}/v1beta`);
	});

	it('has unique ids', () => {
		expect(new Set(snippets.map((s) => s.id)).size).toBe(snippets.length);
	});
});
