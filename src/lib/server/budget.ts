/**
 * Spend enforcement, per bucket. A "bucket" is a scope + id: budgets can be set
 * on a *service* (the aggregate ceiling across all its tokens) and on a *token*
 * (that token's personal cap). Both are enforced independently — a request must
 * stay within whichever budgets apply — so the two scopes never share a pool.
 *
 * Spend is summed from the audit log (the same `costUsd` we already record per
 * request, which carries both serviceId and tokenId), which keeps budgets
 * durable across restarts and consistent with what the dashboard reports.
 * Calendar windows are UTC: "daily" resets at 00:00 UTC, "monthly" on the 1st.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';

export interface BudgetLimits {
	dailyBudgetUsd: string | number;
	monthlyBudgetUsd: string | number;
}

export type BudgetResult = { ok: true } | { ok: false; reason: string };

/**
 * Which entity a budget is summed against. 'instance' sums *all* gateway spend
 * (no id filter) — the broadest ceiling, above the per-service and per-token ones.
 */
export type BudgetScope = 'service' | 'token' | 'instance';

/**
 * In-flight spend reservations, keyed by "scope:id" → reserved USD.
 *
 * The audit-log sum only sees a request's cost *after* it completes (and for
 * streamed responses, only after the stream finishes draining). So N concurrent
 * admits would all read the same pre-burst total and all slip past the ceiling.
 * To close that TOCTOU gap we add a coarse per-bucket "reservation" the moment a
 * request is admitted, and reconcile it against the exact cost (via the audit
 * log) once the request completes and its reservation is released.
 *
 * Like the rate limiter (see ratelimit.ts), this lives in process memory: it's
 * a single-instance, best-effort guard that resets on restart and is not shared
 * across replicas — an acceptable trade-off for the monolith MVP. When the
 * gateway is scaled horizontally, back these reservations with a shared store
 * (e.g. Redis) behind the same reserve/release signatures.
 */
const reservations = new Map<string, number>();

const bucketKey = (scope: BudgetScope, id: string) => `${scope}:${id}`;

/**
 * Nominal per-request reservation. We don't know token counts before the
 * upstream call, so this is intentionally a small fixed estimate, not precise
 * accounting: the correctness property is that concurrent admits can't all see
 * zero pending spend. The reservation is reconciled to the exact cost via the
 * audit log once the request completes (then released). Tune as needed.
 */
export const RESERVATION_ESTIMATE_USD = 0.01;

/** Total USD currently reserved (in flight) for a bucket. */
function reservedFor(scope: BudgetScope, id: string): number {
	return reservations.get(bucketKey(scope, id)) ?? 0;
}

/**
 * Reserve in-flight spend for a bucket and return a one-shot release handle.
 * Call this right after a request passes the budget gate; call the returned
 * handle once the real cost has been written to the audit log.
 */
export function reserve(
	scope: BudgetScope,
	id: string,
	amountUsd = RESERVATION_ESTIMATE_USD
): () => void {
	const key = bucketKey(scope, id);
	reservations.set(key, (reservations.get(key) ?? 0) + amountUsd);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		release(scope, id, amountUsd);
	};
}

/** Drop a previously reserved amount, cleaning up entries that hit (or pass) 0. */
export function release(
	scope: BudgetScope,
	id: string,
	amountUsd = RESERVATION_ESTIMATE_USD
): void {
	const key = bucketKey(scope, id);
	const next = (reservations.get(key) ?? 0) - amountUsd;
	if (next > 0) reservations.set(key, next);
	else reservations.delete(key);
}

function startOfUtcDay(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface SpendWindows {
	/** start of the current UTC day / month — the windows budgets reset on */
	dayStart: Date;
	monthStart: Date;
	dailySpent: number;
	monthlySpent: number;
}

/**
 * Current spend for a bucket across both budget windows plus the window
 * boundaries. Shared by the budget-alert evaluation (see budget-alerts.ts);
 * intentionally ignores in-flight reservations since alerts report realized
 * spend. For the 'instance' scope `id` is ignored (all traffic is summed).
 */
export async function currentSpend(scope: BudgetScope, id: string): Promise<SpendWindows> {
	const dayStart = startOfUtcDay();
	const monthStart = startOfUtcMonth();
	const [dailySpent, monthlySpent] = await Promise.all([
		spendSince(scope, id, dayStart),
		spendSince(scope, id, monthStart)
	]);
	return { dayStart, monthStart, dailySpent, monthlySpent };
}

/** Sum gateway spend (USD) for a bucket since `since`. */
async function spendSince(scope: BudgetScope, id: string, since: Date): Promise<number> {
	// 'instance' has no id filter — it sums every request in the window.
	const filter =
		scope === 'instance'
			? gte(auditLog.createdAt, since)
			: and(
					eq(scope === 'token' ? auditLog.tokenId : auditLog.serviceId, id),
					gte(auditLog.createdAt, since)
				);
	const [row] = await db
		.select({ total: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)` })
		.from(auditLog)
		.where(filter);
	return Number(row?.total ?? 0);
}

/**
 * Check whether a bucket is still within its spend ceilings. A ceiling of 0 (or
 * unset) means unlimited and is skipped — so when neither budget is set we never
 * touch the database.
 *
 * In-flight reservations (concurrent requests that have been admitted but whose
 * cost hasn't landed in the audit log yet) count toward the spend, so a burst of
 * concurrent requests can't all slip past the same pre-burst total.
 */
export async function checkBudget(
	scope: BudgetScope,
	id: string,
	limits: BudgetLimits
): Promise<BudgetResult> {
	const daily = Number(limits.dailyBudgetUsd ?? 0);
	const monthly = Number(limits.monthlyBudgetUsd ?? 0);
	if (daily <= 0 && monthly <= 0) return { ok: true };

	const pending = reservedFor(scope, id);
	const label = scope;

	if (monthly > 0) {
		const spent = (await spendSince(scope, id, startOfUtcMonth())) + pending;
		if (spent >= monthly) {
			return {
				ok: false,
				reason: `${label} monthly budget exhausted ($${spent.toFixed(4)} of $${monthly.toFixed(2)})`
			};
		}
	}

	if (daily > 0) {
		const spent = (await spendSince(scope, id, startOfUtcDay())) + pending;
		if (spent >= daily) {
			return {
				ok: false,
				reason: `${label} daily budget exhausted ($${spent.toFixed(4)} of $${daily.toFixed(2)})`
			};
		}
	}

	return { ok: true };
}
