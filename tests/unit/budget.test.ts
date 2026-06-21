import { describe, it, expect, vi, beforeEach } from 'vitest';

// budget.ts sums spend from the audit log via `db`. We stub the db layer so the
// "audit sum" is fully controllable and no real query ever runs — mirroring how
// the other pure-logic server units stay off the network. The drizzle query is
// a thenable builder (`.from(...).where(...)` then awaited), so we model it as a
// chainable object whose final `then` resolves to a single { total } row.
let auditTotal = 0;

vi.mock('$lib/server/db', () => {
	const builder = {
		from: () => builder,
		where: () => builder,
		// awaiting the builder resolves to the coalesce(sum(...)) result row
		then: (resolve: (rows: Array<{ total: string }>) => unknown) =>
			resolve([{ total: String(auditTotal) }])
	};
	return { db: { select: () => builder } };
});

import { checkBudget, reserve, release, RESERVATION_ESTIMATE_USD } from '$lib/server/budget';

// Each test uses a fresh id so the process-global reservation map stays isolated
// between cases. All cases use the 'service' scope unless they're testing scope.
let n = 0;
const uniqueId = () => `id-${Date.now()}-${n++}`;

beforeEach(() => {
	auditTotal = 0;
});

describe('checkBudget — limits', () => {
	it('treats 0 / unset budgets as unlimited (never queries the db)', async () => {
		auditTotal = 1_000_000; // would blow any real ceiling
		expect(
			await checkBudget('service', uniqueId(), { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 })
		).toEqual({ ok: true });
		expect(
			await checkBudget('service', uniqueId(), {
				dailyBudgetUsd: undefined as unknown as number,
				monthlyBudgetUsd: undefined as unknown as number
			})
		).toEqual({ ok: true });
	});

	it('allows spend below the ceiling and denies at/above it (audit-sum based)', async () => {
		const svc = uniqueId();
		auditTotal = 5;
		expect(
			(await checkBudget('service', svc, { dailyBudgetUsd: 10, monthlyBudgetUsd: 0 })).ok
		).toBe(true);

		auditTotal = 10; // exactly at the ceiling is exhausted
		const denied = await checkBudget('service', svc, { dailyBudgetUsd: 10, monthlyBudgetUsd: 0 });
		expect(denied.ok).toBe(false);
		expect(denied).toMatchObject({ reason: expect.stringContaining('daily budget exhausted') });
	});

	it('enforces the monthly ceiling independently of the daily one', async () => {
		const svc = uniqueId();
		auditTotal = 100;
		const denied = await checkBudget('service', svc, { dailyBudgetUsd: 0, monthlyBudgetUsd: 100 });
		expect(denied.ok).toBe(false);
		expect(denied).toMatchObject({ reason: expect.stringContaining('monthly budget exhausted') });
	});

	it('labels the denial reason with the bucket scope', async () => {
		auditTotal = 10;
		const svc = await checkBudget('service', uniqueId(), {
			dailyBudgetUsd: 10,
			monthlyBudgetUsd: 0
		});
		const tok = await checkBudget('token', uniqueId(), { dailyBudgetUsd: 10, monthlyBudgetUsd: 0 });
		const inst = await checkBudget('instance', 'instance', {
			dailyBudgetUsd: 10,
			monthlyBudgetUsd: 0
		});
		expect(svc).toMatchObject({ reason: expect.stringContaining('service daily') });
		expect(tok).toMatchObject({ reason: expect.stringContaining('token daily') });
		expect(inst).toMatchObject({ reason: expect.stringContaining('instance daily') });
	});

	it('enforces the instance scope from the audit sum (all traffic)', async () => {
		auditTotal = 4;
		expect(
			(await checkBudget('instance', 'instance', { dailyBudgetUsd: 0, monthlyBudgetUsd: 5 })).ok
		).toBe(true);
		auditTotal = 5;
		expect(
			(await checkBudget('instance', 'instance', { dailyBudgetUsd: 0, monthlyBudgetUsd: 5 })).ok
		).toBe(false);
	});
});

describe('checkBudget — in-flight reservations (TOCTOU guard)', () => {
	it('counts a reservation toward the ceiling so a concurrent check is denied', async () => {
		const svc = uniqueId();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };

		auditTotal = 0;
		expect((await checkBudget('service', svc, limits)).ok).toBe(true);

		reserve('service', svc); // admit one concurrent request
		const denied = await checkBudget('service', svc, limits);
		expect(denied.ok).toBe(false);
		expect(denied).toMatchObject({ reason: expect.stringContaining('daily budget exhausted') });
	});

	it('stacks multiple reservations additively', async () => {
		const svc = uniqueId();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD * 3, monthlyBudgetUsd: 0 };
		reserve('service', svc);
		reserve('service', svc);
		expect((await checkBudget('service', svc, limits)).ok).toBe(true);
		reserve('service', svc);
		expect((await checkBudget('service', svc, limits)).ok).toBe(false);
	});

	it('releasing a reservation restores headroom', async () => {
		const svc = uniqueId();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };

		const releaseHandle = reserve('service', svc);
		expect((await checkBudget('service', svc, limits)).ok).toBe(false);

		releaseHandle();
		expect((await checkBudget('service', svc, limits)).ok).toBe(true);
	});

	it('the release handle is idempotent (no double-release underflow)', async () => {
		const svc = uniqueId();
		const a = reserve('service', svc);
		reserve('service', svc);
		a();
		a(); // second call is a no-op, must not cancel the other reservation
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };
		expect((await checkBudget('service', svc, limits)).ok).toBe(false);
	});

	it('release() never drives an entry negative and cleans up at zero', async () => {
		const svc = uniqueId();
		reserve('service', svc);
		release('service', svc);
		release('service', svc); // over-release must not leave a negative pending amount
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD * 2, monthlyBudgetUsd: 0 };
		reserve('service', svc);
		expect((await checkBudget('service', svc, limits)).ok).toBe(true);
	});

	it('keeps reservations isolated per bucket id', async () => {
		const a = uniqueId();
		const b = uniqueId();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };
		reserve('service', a);
		expect((await checkBudget('service', a, limits)).ok).toBe(false); // a exhausted
		expect((await checkBudget('service', b, limits)).ok).toBe(true); // b untouched
	});

	it('keeps the service and token scopes isolated even for the same id', async () => {
		const id = uniqueId();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };
		reserve('service', id); // exhausts the service bucket only
		expect((await checkBudget('service', id, limits)).ok).toBe(false);
		expect((await checkBudget('token', id, limits)).ok).toBe(true);
	});

	it('adds the reservation on top of existing audit spend', async () => {
		const svc = uniqueId();
		const limits = { dailyBudgetUsd: 1, monthlyBudgetUsd: 0 };
		auditTotal = 1 - RESERVATION_ESTIMATE_USD / 2; // just under the ceiling on its own
		expect((await checkBudget('service', svc, limits)).ok).toBe(true);
		reserve('service', svc); // audit + reservation now exceeds the ceiling
		expect((await checkBudget('service', svc, limits)).ok).toBe(false);
	});
});
