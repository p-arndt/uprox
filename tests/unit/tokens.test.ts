import { describe, it, expect } from 'vitest';
import { issueToken, TOKEN_PREFIX } from '$lib/server/tokens';
import { sha256, encrypt, decrypt } from '$lib/server/crypto';

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

describe('re-copyable token storage', () => {
	// A re-copyable token stores encrypt(plaintext) alongside the hash so the
	// secret can be revealed again (see createToken / revealToken). Auth still
	// matches on the hash, never the encrypted copy.
	it('round-trips the stored secret so it can be revealed again', () => {
		const { plaintext } = issueToken();
		const stored = encrypt(plaintext);
		expect(stored).not.toContain(plaintext); // ciphertext, not plaintext at rest
		expect(decrypt(stored)).toBe(plaintext); // recoverable for re-copy
	});

	it('leaves the auth path unchanged — the hash still matches the revealed secret', () => {
		const { plaintext, hashedToken } = issueToken();
		const revealed = decrypt(encrypt(plaintext));
		expect(sha256(revealed)).toBe(hashedToken);
	});
});
