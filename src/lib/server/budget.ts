/**
 * Per-service spend enforcement. Budgets are configured on a policy (daily and
 * monthly USD ceilings) and enforced against the spend of the *service* making
 * the request — so two services sharing a policy each get their own bucket.
 *
 * Spend is summed from the audit log (the same `costUsd` we already record per
 * request), which keeps budgets durable across restarts and consistent with
 * what the dashboard reports. Calendar windows are UTC: "daily" resets at
 * 00:00 UTC, "monthly" on the 1st.
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
 * In-flight spend reservations, keyed by serviceId → reserved USD.
 *
 * The audit-log sum only sees a request's cost *after* it completes (and for
 * streamed responses, only after the stream finishes draining). So N concurrent
 * admits would all read the same pre-burst total and all slip past the ceiling.
 * To close that TOCTOU gap we add a coarse, per-service "reservation" the moment
 * a request is admitted, and reconcile it against the exact cost (via the audit
 * log) once the request completes and its reservation is released.
 *
 * Like the rate limiter (see ratelimit.ts), this lives in process memory: it's
 * a single-instance, best-effort guard that resets on restart and is not shared
 * across replicas — an acceptable trade-off for the monolith MVP. When the
 * gateway is scaled horizontally, back these reservations with a shared store
 * (e.g. Redis) behind the same reserve/release signatures.
 */
const reservations = new Map<string, number>();

/**
 * Nominal per-request reservation. We don't know token counts before the
 * upstream call, so this is intentionally a small fixed estimate, not precise
 * accounting: the correctness property is that concurrent admits can't all see
 * zero pending spend. The reservation is reconciled to the exact cost via the
 * audit log once the request completes (then released). Tune as needed.
 */
export const RESERVATION_ESTIMATE_USD = 0.01;

/** Total USD currently reserved (in flight) for a service. */
function reservedFor(serviceId: string): number {
	return reservations.get(serviceId) ?? 0;
}

/**
 * Reserve in-flight spend for a service and return a one-shot release handle.
 * Call this right after a request passes the budget gate; call the returned
 * handle once the real cost has been written to the audit log.
 */
export function reserve(serviceId: string, amountUsd = RESERVATION_ESTIMATE_USD): () => void {
	reservations.set(serviceId, reservedFor(serviceId) + amountUsd);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		release(serviceId, amountUsd);
	};
}

/** Drop a previously reserved amount, cleaning up entries that hit (or pass) 0. */
export function release(serviceId: string, amountUsd = RESERVATION_ESTIMATE_USD): void {
	const next = reservedFor(serviceId) - amountUsd;
	if (next > 0) reservations.set(serviceId, next);
	else reservations.delete(serviceId);
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
 * Current per-service spend for both budget windows plus the window boundaries.
 * Shared by the budget-alert evaluation (see budget-alerts.ts); intentionally
 * ignores in-flight reservations since alerts report realized spend.
 */
export async function currentSpend(serviceId: string): Promise<SpendWindows> {
	const dayStart = startOfUtcDay();
	const monthStart = startOfUtcMonth();
	const [dailySpent, monthlySpent] = await Promise.all([
		spendSince(serviceId, dayStart),
		spendSince(serviceId, monthStart)
	]);
	return { dayStart, monthStart, dailySpent, monthlySpent };
}

/** Sum gateway spend (USD) for a service since `since`. */
async function spendSince(serviceId: string, since: Date): Promise<number> {
	const [row] = await db
		.select({ total: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)` })
		.from(auditLog)
		.where(and(eq(auditLog.serviceId, serviceId), gte(auditLog.createdAt, since)));
	return Number(row?.total ?? 0);
}

/**
 * Check whether `serviceId` is still within its policy's spend ceilings.
 * A ceiling of 0 (or unset) means unlimited and is skipped — so when neither
 * budget is set we never touch the database.
 *
 * In-flight reservations (concurrent requests that have been admitted but whose
 * cost hasn't landed in the audit log yet) count toward the spend, so a burst
 * of concurrent requests can't all slip past the same pre-burst total.
 */
export async function checkBudget(serviceId: string, limits: BudgetLimits): Promise<BudgetResult> {
	const daily = Number(limits.dailyBudgetUsd ?? 0);
	const monthly = Number(limits.monthlyBudgetUsd ?? 0);
	if (daily <= 0 && monthly <= 0) return { ok: true };

	const pending = reservedFor(serviceId);

	if (monthly > 0) {
		const spent = (await spendSince(serviceId, startOfUtcMonth())) + pending;
		if (spent >= monthly) {
			return {
				ok: false,
				reason: `monthly budget exhausted ($${spent.toFixed(4)} of $${monthly.toFixed(2)})`
			};
		}
	}

	if (daily > 0) {
		const spent = (await spendSince(serviceId, startOfUtcDay())) + pending;
		if (spent >= daily) {
			return {
				ok: false,
				reason: `daily budget exhausted ($${spent.toFixed(4)} of $${daily.toFixed(2)})`
			};
		}
	}

	return { ok: true };
}
