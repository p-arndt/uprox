import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';
import { env } from '$env/dynamic/private';

const ALGO = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

/** Resolve and validate the 32-byte master key from the environment. */
function masterKey(): Buffer {
	if (cachedKey) return cachedKey;
	const raw = env.ENCRYPTION_KEY;
	if (!raw) throw new Error('ENCRYPTION_KEY is not set');
	const key = Buffer.from(raw, 'base64');
	if (key.length !== 32) {
		throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`);
	}
	cachedKey = key;
	return key;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns a self-describing string: `iv.authTag.ciphertext`, each base64.
 */
export function encrypt(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGO, masterKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
		'.'
	);
}

/** Reverse {@link encrypt}. Throws if the payload was tampered with. */
export function decrypt(payload: string): string {
	const [ivB64, tagB64, dataB64] = payload.split('.');
	if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed ciphertext');
	const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(ivB64, 'base64'));
	decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
	return Buffer.concat([
		decipher.update(Buffer.from(dataB64, 'base64')),
		decipher.final()
	]).toString('utf8');
}

/** Stable sha256 hex digest — used for machine tokens (never store raw). */
export function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
	const ba = Buffer.from(a, 'hex');
	const bb = Buffer.from(b, 'hex');
	if (ba.length !== bb.length) return false;
	return timingSafeEqual(ba, bb);
}
