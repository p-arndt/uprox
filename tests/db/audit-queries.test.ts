import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog, machineToken } from '$lib/server/db/schema';
import { createService } from '$lib/server/services';
import { listAudit, listAuditPage } from '$lib/server/audit-queries';

const hoursAgo = (hours: number) => sql`now() - make_interval(hours => ${hours})`;

describe('listAuditPage (real SQL)', () => {
	let tokenId: string;

	beforeEach(async () => {
		await db.delete(auditLog);
		const svc = await createService({ name: `svc-${crypto.randomUUID()}` });
		const [token] = await db
			.insert(machineToken)
			.values({
				serviceId: svc!.id,
				name: 'ci-bot',
				display: 'uprox_live_x…',
				hashedToken: `hash-${crypto.randomUUID()}`
			})
			.returning();
		tokenId = token!.id;

		await db.insert(auditLog).values([
			{
				action: 'gateway.chat',
				status: 'ok',
				provider: 'openai',
				model: 'gpt-4o',
				serviceId: svc!.id,
				tokenId,
				createdAt: hoursAgo(1)
			},
			{ action: 'gateway.chat', status: 'deny', model: 'gpt-4o', tokenId, createdAt: hoursAgo(2) },
			{ action: 'gateway.embeddings', status: 'error', detail: '50% off', createdAt: hoursAgo(3) },
			{ action: 'token.revoke', status: 'ok', tokenId, createdAt: hoursAgo(4) },
			{ action: 'policy.delete', status: 'ok', detail: 'strict', createdAt: hoursAgo(48) }
		]);
	});

	it('returns everything newest first with token and service names', async () => {
		const { entries, nextCursor } = await listAuditPage({});

		expect(entries.map((e) => e.action)).toEqual([
			'gateway.chat',
			'gateway.chat',
			'gateway.embeddings',
			'token.revoke',
			'policy.delete'
		]);
		expect(entries[0]).toMatchObject({ tokenName: 'ci-bot', provider: 'openai' });
		expect(entries[0]!.serviceName).toMatch(/^svc-/);
		expect(nextCursor).toBeNull();
	});

	it('filters by status tone, treating allow and ok alike', async () => {
		await db.insert(auditLog).values({ action: 'gateway.chat', status: 'allow' });

		const ok = await listAuditPage({ status: 'ok' });
		expect(ok.entries).toHaveLength(4);
		expect((await listAuditPage({ status: 'denied' })).entries).toHaveLength(1);
		expect((await listAuditPage({ status: 'error' })).entries).toHaveLength(1);
	});

	it('filters by kind and time range', async () => {
		expect((await listAuditPage({ kind: 'gateway' })).entries).toHaveLength(3);
		expect((await listAuditPage({ kind: 'admin' })).entries.map((e) => e.action)).toEqual([
			'token.revoke',
			'policy.delete'
		]);
		expect((await listAuditPage({ range: '24h' })).entries).toHaveLength(4);
		expect((await listAuditPage({ range: '1h', kind: 'admin' })).entries).toHaveLength(0);
	});

	it('searches across joined names and matches LIKE wildcards literally', async () => {
		expect((await listAuditPage({ q: 'CI-BOT' })).entries).toHaveLength(3);
		expect((await listAuditPage({ q: 'openai' })).entries).toHaveLength(1);
		expect((await listAuditPage({ q: '50%' })).entries).toHaveLength(1);
		// "_" must not act as a single-character wildcard
		expect((await listAuditPage({ q: 'gpt_4o' })).entries).toHaveLength(0);
	});

	it('pages with a cursor without skipping or repeating rows', async () => {
		const first = await listAuditPage({}, 2);
		expect(first.entries).toHaveLength(2);
		expect(first.nextCursor).toBe(first.entries[1]!.id);

		const second = await listAuditPage({ cursor: first.nextCursor! }, 2);
		const third = await listAuditPage({ cursor: second.nextCursor! }, 2);
		expect(third.nextCursor).toBeNull();

		const ids = [...first.entries, ...second.entries, ...third.entries].map((e) => e.id);
		expect(ids).toEqual((await listAudit(10)).map((e) => e.id));
	});

	it('orders rows sharing a timestamp stably across pages', async () => {
		await db.delete(auditLog);
		await db.insert(auditLog).values(
			Array.from({ length: 5 }, () => ({
				action: 'gateway.chat',
				status: 'ok',
				createdAt: hoursAgo(0)
			}))
		);

		const first = await listAuditPage({}, 3);
		const rest = await listAuditPage({ cursor: first.nextCursor! }, 3);
		const ids = [...first.entries, ...rest.entries].map((e) => e.id);
		expect(new Set(ids).size).toBe(5);
		expect(rest.nextCursor).toBeNull();
	});
});
