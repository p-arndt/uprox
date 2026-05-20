// One-off: provision an org/service/token via the REST API and print the token.
const BASE = process.env.UPROX_URL?.replace(/\/v1$/, '') ?? 'http://localhost:5173';
let cookie = '';

async function api(method, path, body) {
	const headers = { 'content-type': 'application/json', origin: BASE };
	if (cookie) headers.cookie = cookie;
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined
	});
	for (const c of res.headers.getSetCookie?.() ?? []) cookie += (cookie ? '; ' : '') + c.split(';')[0];
	const text = await res.text();
	try {
		return { status: res.status, json: JSON.parse(text) };
	} catch {
		return { status: res.status, json: text };
	}
}

const email = `demo_${Date.now()}@example.com`;
await api('POST', '/api/auth/sign-up/email', { name: 'Demo', email, password: 'supersecret123' });

// optional policy (OpenAI only) + service
const policy = await api('POST', '/api/policies', {
	name: 'openai-only',
	allowedProviders: ['openai']
});
const service = await api('POST', '/api/services', {
	name: 'demo-agent',
	type: 'agent',
	policyId: policy.json.id
});
const token = await api('POST', '/api/tokens', { serviceId: service.json.id, name: 'demo' });

// configure a provider key so the gateway has something to proxy with.
// Uses OPENAI_API_KEY from env if present (real completions); otherwise a placeholder.
await api('POST', '/api/providers', {
	provider: 'openai',
	secret: process.env.OPENAI_API_KEY || 'sk-placeholder-no-real-key'
});

console.log(token.json.token);
