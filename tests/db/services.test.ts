import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { machineToken } from '$lib/server/db/schema';
import {
	countActiveTokensByService,
	createService,
	deleteService,
	getOrCreateDefaultService,
	listServiceTokens
} from '$lib/server/services';

const DAY_MS = 24 * 60 * 60 * 1000;
let seq = 0;

function addToken(serviceId: string, overrides: Partial<typeof machineToken.$inferInsert> = {}) {
	seq++;
	return db
		.insert(machineToken)
		.values({
			serviceId,
			name: `token-${seq}`,
			display: `uprox_live_${seq}…`,
			hashedToken: `hash-${seq}`,
			...overrides
		})
		.returning();
}

describe('service token queries (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from machine_token`);
		await db.execute(sql`delete from service`);
	});

	it('counts only active tokens, grouped per service', async () => {
		const a = await createService({ name: 'a' });
		const b = await createService({ name: 'b' });
		const empty = await createService({ name: 'empty' });
		await addToken(a!.id);
		await addToken(a!.id, { expiresAt: new Date(Date.now() + DAY_MS) });
		await addToken(a!.id, { revokedAt: new Date() });
		await addToken(a!.id, { expiresAt: new Date(Date.now() - DAY_MS) });
		await addToken(b!.id);

		const counts = await countActiveTokensByService();

		expect(counts).toEqual({ [a!.id]: 2, [b!.id]: 1 });
		expect(counts[empty!.id]).toBeUndefined();
	});

	it('drops a deleted service to zero active tokens', async () => {
		const s = await createService({ name: 'retired' });
		await addToken(s!.id);
		await deleteService(s!.id);

		expect(await countActiveTokensByService()).toEqual({});
	});

	it('lists every token of the service, newest first, without secrets', async () => {
		const s = await createService({ name: 'svc' });
		const other = await createService({ name: 'other' });
		await addToken(s!.id, { name: 'old', createdAt: new Date(Date.now() - 2 * DAY_MS) });
		await addToken(s!.id, { name: 'revoked', revokedAt: new Date(), createdAt: new Date() });
		await addToken(s!.id, {
			name: 'expired',
			expiresAt: new Date(Date.now() - DAY_MS),
			createdAt: new Date(Date.now() - DAY_MS)
		});
		await addToken(other!.id, { name: 'foreign' });

		const tokens = await listServiceTokens(s!.id);

		expect(tokens.map((t) => t.name)).toEqual(['revoked', 'expired', 'old']);
		expect(tokens[0]).not.toHaveProperty('hashedToken');
		expect(tokens[0]).not.toHaveProperty('encryptedToken');
		expect(tokens[2]).toMatchObject({ lastUsedAt: null, revokedAt: null, expiresAt: null });
	});

	it('names the Default service as a catch-all service', async () => {
		const s = await getOrCreateDefaultService();
		expect(s!.description).toBe('Catch-all service for tokens created without one.');
	});
});
