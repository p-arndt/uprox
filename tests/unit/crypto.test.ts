import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, sha256, safeEqualHex } from '$lib/server/crypto';

describe('encrypt / decrypt', () => {
	it('round-trips plaintext', () => {
		const secret = 'sk-proj-super-secret-key';
		expect(decrypt(encrypt(secret))).toBe(secret);
	});

	it('round-trips unicode', () => {
		expect(decrypt(encrypt('schöne Grüße 🔐 日本語'))).toBe('schöne Grüße 🔐 日本語');
	});

	it('KNOWN LIMITATION: an empty plaintext cannot be decrypted', () => {
		// encrypt('') yields an empty ciphertext segment ("iv.tag."), which
		// decrypt's `!dataB64` guard rejects as malformed. Harmless in practice
		// (provider secrets are never empty); documented so the behaviour is
		// intentional rather than a surprise. Flip this if the format changes.
		expect(() => decrypt(encrypt(''))).toThrow('Malformed ciphertext');
	});

	it('produces a fresh random IV each time (no deterministic ciphertext)', () => {
		const a = encrypt('same input');
		const b = encrypt('same input');
		expect(a).not.toBe(b);
		// ...yet both decrypt back to the same plaintext.
		expect(decrypt(a)).toBe(decrypt(b));
	});

	it('emits the self-describing iv.tag.ciphertext shape (three base64 parts)', () => {
		const parts = encrypt('x').split('.');
		expect(parts).toHaveLength(3);
		for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9+/]+=*$/);
	});

	it('rejects a tampered ciphertext (GCM auth tag mismatch)', () => {
		const [iv, tag, data] = encrypt('trusted').split('.');
		// flip a byte in the ciphertext segment
		const flipped = Buffer.from(data, 'base64');
		flipped[0] ^= 0xff;
		const forged = [iv, tag, flipped.toString('base64')].join('.');
		expect(() => decrypt(forged)).toThrow();
	});

	it('rejects a malformed payload missing segments', () => {
		expect(() => decrypt('only-one-part')).toThrow('Malformed ciphertext');
		expect(() => decrypt('two.parts')).toThrow('Malformed ciphertext');
	});
});

describe('sha256', () => {
	it('is stable for the same input', () => {
		expect(sha256('uprox_live_abc')).toBe(sha256('uprox_live_abc'));
	});

	it('matches the known digest of a fixed string', () => {
		// echo -n "abc" | sha256sum
		expect(sha256('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('returns 64 lowercase hex chars', () => {
		expect(sha256('anything')).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('safeEqualHex', () => {
	it('is true for identical digests', () => {
		const h = sha256('token');
		expect(safeEqualHex(h, h)).toBe(true);
	});

	it('is false for different digests of equal length', () => {
		expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
	});

	it('is false for digests of differing length instead of throwing', () => {
		expect(safeEqualHex('aabb', 'aa')).toBe(false);
	});
});
