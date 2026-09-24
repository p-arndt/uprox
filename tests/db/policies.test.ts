import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { machineToken, service } from '$lib/server/db/schema';
import {
	createPolicy,
	deletePolicy,
	knownModelIds,
	policyNameTaken,
	policyUsageCounts
} from '$lib/server/policies';
import { invalidatePriceCache } from '$lib/server/pricing';

function must<T>(row: T | undefined): T {
	if (!row) throw new Error('expected a row');
	return row;
}

const preset = async (name: string) => must(await createPolicy({ name }));

let seq = 0;
async function addService(policyId: string | null, deleted = false) {
	const [row] = await db
		.insert(service)
		.values({ name: `svc-${seq++}`, policyId, deletedAt: deleted ? new Date() : null })
		.returning();
	return must(row);
}

async function addToken(serviceId: string, policyId: string | null, revoked = false) {
	const n = seq++;
	await db.insert(machineToken).values({
		serviceId,
		name: `tok-${n}`,
		display: `uprox_${n}`,
		hashedToken: `hash-${n}`,
		policyId,
		revokedAt: revoked ? new Date() : null
	});
}

describe('presets (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from machine_token`);
		await db.execute(sql`delete from service`);
		await db.execute(sql`delete from policy`);
	});

	it('counts live services and active tokens per preset', async () => {
		const a = await preset('A');
		const b = await preset('B');
		const unused = await preset('C');

		const s1 = await addService(a.id);
		await addService(a.id);
		await addService(a.id, true);
		const plain = await addService(null);
		await addToken(s1.id, a.id);
		await addToken(plain.id, b.id);
		await addToken(plain.id, b.id);
		await addToken(plain.id, b.id, true);
		await addToken(plain.id, null);

		const usage = await policyUsageCounts();
		expect(usage[a.id]).toEqual({ services: 2, tokens: 1 });
		expect(usage[b.id]).toEqual({ services: 0, tokens: 2 });
		expect(usage[unused.id]).toBeUndefined();
	});

	it('detaches services and tokens when a preset is deleted', async () => {
		const p = await preset('gone');
		const s = await addService(p.id);
		await addToken(s.id, p.id);

		expect(await deletePolicy(p.id)).toBe(true);
		const svc = must((await db.select().from(service))[0]);
		const tok = must((await db.select().from(machineToken))[0]);
		expect(svc.policyId).toBeNull();
		expect(tok.policyId).toBeNull();
		expect(await policyUsageCounts()).toEqual({});
	});

	it('treats preset names as taken case-insensitively, except for the preset itself', async () => {
		const p = await preset('Standard');

		expect(await policyNameTaken('standard')).toBe(true);
		expect(await policyNameTaken('  STANDARD ')).toBe(true);
		expect(await policyNameTaken('Standard', p.id)).toBe(false);
		expect(await policyNameTaken('Premium')).toBe(false);
	});

	it('lists known model ids from the effective price map', async () => {
		await db.execute(sql`delete from model_price`);
		await db.execute(sql`
			insert into model_price (model, is_default, input_per_mtok, output_per_mtok)
			values ('zeta-model', true, 1, 1), ('Alpha-Model', true, 1, 1)
		`);
		invalidatePriceCache();

		expect(await knownModelIds()).toEqual(['alpha-model', 'zeta-model']);
	});
});
