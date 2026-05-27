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

// Each test uses a fresh serviceId so the process-global reservation map stays
// isolated between cases.
let n = 0;
const uniqueService = () => `svc-${Date.now()}-${n++}`;

beforeEach(() => {
	auditTotal = 0;
});

describe('checkBudget — limits', () => {
	it('treats 0 / unset budgets as unlimited (never queries the db)', async () => {
		auditTotal = 1_000_000; // would blow any real ceiling
		expect(await checkBudget(uniqueService(), { dailyBudgetUsd: 0, monthlyBudgetUsd: 0 })).toEqual({
			ok: true
		});
		expect(
			await checkBudget(uniqueService(), {
				dailyBudgetUsd: undefined as unknown as number,
				monthlyBudgetUsd: undefined as unknown as number
			})
		).toEqual({ ok: true });
	});

	it('allows spend below the ceiling and denies at/above it (audit-sum based)', async () => {
		const svc = uniqueService();
		auditTotal = 5;
		expect((await checkBudget(svc, { dailyBudgetUsd: 10, monthlyBudgetUsd: 0 })).ok).toBe(true);

		auditTotal = 10; // exactly at the ceiling is exhausted
		const denied = await checkBudget(svc, { dailyBudgetUsd: 10, monthlyBudgetUsd: 0 });
		expect(denied.ok).toBe(false);
		expect(denied).toMatchObject({ reason: expect.stringContaining('daily budget exhausted') });
	});

	it('enforces the monthly ceiling independently of the daily one', async () => {
		const svc = uniqueService();
		auditTotal = 100;
		const denied = await checkBudget(svc, { dailyBudgetUsd: 0, monthlyBudgetUsd: 100 });
		expect(denied.ok).toBe(false);
		expect(denied).toMatchObject({ reason: expect.stringContaining('monthly budget exhausted') });
	});
});

describe('checkBudget — in-flight reservations (TOCTOU guard)', () => {
	it('counts a reservation toward the ceiling so a concurrent check is denied', async () => {
		const svc = uniqueService();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };

		// audit sum is still 0 (the in-flight request hasn't recorded cost yet),
		// but reserving the estimate pushes the service to its ceiling.
		auditTotal = 0;
		expect((await checkBudget(svc, limits)).ok).toBe(true);

		reserve(svc); // admit one concurrent request
		const denied = await checkBudget(svc, limits);
		expect(denied.ok).toBe(false);
		expect(denied).toMatchObject({ reason: expect.stringContaining('daily budget exhausted') });
	});

	it('stacks multiple reservations additively', async () => {
		const svc = uniqueService();
		// ceiling of 3 estimates: two in-flight still fit, the third trips it.
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD * 3, monthlyBudgetUsd: 0 };
		reserve(svc);
		reserve(svc);
		expect((await checkBudget(svc, limits)).ok).toBe(true);
		reserve(svc);
		expect((await checkBudget(svc, limits)).ok).toBe(false);
	});

	it('releasing a reservation restores headroom', async () => {
		const svc = uniqueService();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };

		const releaseHandle = reserve(svc);
		expect((await checkBudget(svc, limits)).ok).toBe(false);

		releaseHandle();
		expect((await checkBudget(svc, limits)).ok).toBe(true);
	});

	it('the release handle is idempotent (no double-release underflow)', async () => {
		const svc = uniqueService();
		const a = reserve(svc);
		const b = reserve(svc);
		a();
		a(); // second call is a no-op, must not cancel b's reservation
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };
		// one reservation still outstanding → at ceiling → denied
		expect((await checkBudget(svc, limits)).ok).toBe(false);
		b();
		expect((await checkBudget(svc, limits)).ok).toBe(true);
	});

	it('release() never drives an entry negative and cleans up at zero', async () => {
		const svc = uniqueService();
		reserve(svc);
		release(svc);
		release(svc); // over-release must not leave a negative pending amount
		// a fresh ceiling-sized reservation should now fit exactly once
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD * 2, monthlyBudgetUsd: 0 };
		reserve(svc);
		expect((await checkBudget(svc, limits)).ok).toBe(true);
	});

	it('keeps reservations isolated per service', async () => {
		const a = uniqueService();
		const b = uniqueService();
		const limits = { dailyBudgetUsd: RESERVATION_ESTIMATE_USD, monthlyBudgetUsd: 0 };
		reserve(a);
		expect((await checkBudget(a, limits)).ok).toBe(false); // a exhausted
		expect((await checkBudget(b, limits)).ok).toBe(true); // b untouched
	});

	it('adds the reservation on top of existing audit spend', async () => {
		const svc = uniqueService();
		const limits = { dailyBudgetUsd: 1, monthlyBudgetUsd: 0 };
		auditTotal = 1 - RESERVATION_ESTIMATE_USD / 2; // just under the ceiling on its own
		expect((await checkBudget(svc, limits)).ok).toBe(true);
		reserve(svc); // audit + reservation now exceeds the ceiling
		expect((await checkBudget(svc, limits)).ok).toBe(false);
	});
});
