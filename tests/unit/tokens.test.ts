import { describe, it, expect } from 'vitest';
import { issueToken, TOKEN_PREFIX } from '$lib/server/tokens';
import { sha256 } from '$lib/server/crypto';

describe('issueToken', () => {
	it('mints a plaintext behind the recognizable prefix', () => {
		const { plaintext } = issueToken();
		expect(plaintext.startsWith(TOKEN_PREFIX)).toBe(true);
		// 32 random bytes base64url-encoded → 43 chars after the prefix
		expect(plaintext.length).toBe(TOKEN_PREFIX.length + 43);
	});

	it('uses a url-safe alphabet for the secret (base64url, no +/=)', () => {
		const secret = issueToken().plaintext.slice(TOKEN_PREFIX.length);
		expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('stores only the sha256 of the plaintext, never the plaintext', () => {
		const { plaintext, hashedToken } = issueToken();
		expect(hashedToken).toBe(sha256(plaintext));
		expect(hashedToken).not.toContain(plaintext);
		expect(hashedToken).toMatch(/^[0-9a-f]{64}$/);
	});

	it('builds a masked display string that leaks neither the middle nor the full secret', () => {
		const { plaintext, display } = issueToken();
		const secret = plaintext.slice(TOKEN_PREFIX.length);
		expect(display.startsWith(`${TOKEN_PREFIX}${secret.slice(0, 6)}`)).toBe(true);
		expect(display.endsWith(secret.slice(-4))).toBe(true);
		expect(display).toContain('…');
		expect(display).not.toBe(plaintext);
	});

	it('is unique across calls (random secret + distinct hash)', () => {
		const a = issueToken();
		const b = issueToken();
		expect(a.plaintext).not.toBe(b.plaintext);
		expect(a.hashedToken).not.toBe(b.hashedToken);
	});
});
