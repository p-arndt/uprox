import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { machineToken } from '$lib/server/db/schema';
import { encrypt } from '$lib/server/crypto';
import { createService } from '$lib/server/services';
import { revealToken, revokeToken, updateToken } from '$lib/server/tokens-admin';

const DAY_MS = 24 * 60 * 60 * 1000;
let seq = 0;

async function insertToken(opts: { expiresAt?: Date; recopyable?: boolean } = {}) {
	seq++;
	const svc = await createService({ name: `svc-${seq}` });
	const [token] = await db
		.insert(machineToken)
		.values({
			serviceId: svc!.id,
			name: `token-${seq}`,
			display: `uprox_live_${seq}…`,
			hashedToken: `hash-${seq}`,
			encryptedToken: opts.recopyable ? encrypt(`uprox_live_secret_${seq}`) : null,
			expiresAt: opts.expiresAt ?? null
		})
		.returning();
	return token!;
}

async function storedRow(id: string) {
	const [row] = await db.select().from(machineToken).where(eq(machineToken.id, id));
	return row!;
}

describe('updateToken expiry and re-copy (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from machine_token`);
		await db.execute(sql`delete from service`);
	});

	it('sets, moves and clears the expiry', async () => {
		const token = await insertToken();
		const in30 = new Date(Date.now() + 30 * DAY_MS);

		await updateToken(token.id, { expiresAt: in30 });
		expect((await storedRow(token.id)).expiresAt?.getTime()).toBe(in30.getTime());

		await updateToken(token.id, { expiresAt: null });
		expect((await storedRow(token.id)).expiresAt).toBeNull();
	});

	it('leaves the expiry alone when the patch omits it', async () => {
		const in90 = new Date(Date.now() + 90 * DAY_MS);
		const token = await insertToken({ expiresAt: in90 });

		await updateToken(token.id, { name: 'renamed' });

		expect((await storedRow(token.id)).expiresAt?.getTime()).toBe(in90.getTime());
	});

	it('can revive an expired token with a new future expiry', async () => {
		const token = await insertToken({ expiresAt: new Date(Date.now() - DAY_MS) });
		const in30 = new Date(Date.now() + 30 * DAY_MS);

		expect(await updateToken(token.id, { expiresAt: in30 })).not.toBeNull();
	});

	it('refuses an expiry in the past', async () => {
		const token = await insertToken();

		await expect(
			updateToken(token.id, { expiresAt: new Date(Date.now() - DAY_MS) })
		).rejects.toThrow('Expiry must be in the future');
		expect((await storedRow(token.id)).expiresAt).toBeNull();
	});

	it('switching re-copy off drops the stored secret for good', async () => {
		const token = await insertToken({ recopyable: true });
		expect(await revealToken(token.id)).not.toBeNull();

		await updateToken(token.id, { recopyable: false });

		expect((await storedRow(token.id)).encryptedToken).toBeNull();
		expect(await revealToken(token.id)).toBeNull();
	});

	it('keeps the stored secret when the patch does not mention re-copy', async () => {
		const token = await insertToken({ recopyable: true });

		await updateToken(token.id, { name: 'renamed' });

		expect((await storedRow(token.id)).encryptedToken).not.toBeNull();
	});

	it('does not touch revoked tokens', async () => {
		const token = await insertToken({ recopyable: true });
		await revokeToken(token.id);

		const result = await updateToken(token.id, {
			recopyable: false,
			expiresAt: new Date(Date.now() + DAY_MS)
		});

		expect(result).toBeNull();
		const row = await storedRow(token.id);
		expect(row.encryptedToken).not.toBeNull();
		expect(row.expiresAt).toBeNull();
	});
});

describe('revealToken (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from machine_token`);
	});

	it('refuses to reveal the stored secret of a revoked token', async () => {
		const token = await insertToken({ recopyable: true });
		await revokeToken(token.id);

		expect(await revealToken(token.id)).toBeNull();
	});
});
