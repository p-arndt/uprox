/** The instance settings singleton. */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';

export interface Settings {
	cacheTtlSeconds: number;
	membersCanManageTokens: boolean;
	membersCanManageServices: boolean;
	tokensRecopyableDefault: boolean;
	// instance-wide spend ceilings across all services/tokens; null = unlimited
	dailyBudgetUsd: number | null;
	monthlyBudgetUsd: number | null;
	budgetAlertsEnabled: boolean;
	budgetAlertThresholdPct: number;
	budgetAlertEmail: string | null;
	tracingEnabled: boolean;
	tracingRetentionDays: number;
	// whether SSO sign-in may create accounts for users who aren't members yet
	ssoSignupEnabled: boolean;
}

/**
 * How one setting maps between the `settings` row and {@link Settings}. Column
 * and field names are identical, so a field only declares its default (used
 * when the row or the column is missing), an optional `read` for columns whose
 * stored shape differs (numeric strings), and an optional `write` that
 * normalizes caller input before it is persisted.
 */
interface FieldCodec {
	fallback: unknown;
	read?: (stored: never) => unknown;
	write?: (input: never) => unknown;
}

/** A numeric column (string in drizzle/pg) to a number. */
const numeric = (stored: string) => Number(stored);

/** Budgets: null or a non-positive number clears the ceiling (unlimited). */
const ceiling = (input: number | null) => (input && input > 0 ? String(input) : null);

const FIELDS: Record<keyof Settings, FieldCodec> = {
	cacheTtlSeconds: {
		fallback: 0,
		write: (input: number) => Math.max(0, Math.floor(input) || 0)
	},
	membersCanManageTokens: { fallback: false },
	membersCanManageServices: { fallback: false },
	tokensRecopyableDefault: { fallback: false },
	dailyBudgetUsd: { fallback: null, read: numeric, write: ceiling },
	monthlyBudgetUsd: { fallback: null, read: numeric, write: ceiling },
	budgetAlertsEnabled: { fallback: false },
	budgetAlertThresholdPct: {
		fallback: 80,
		// clamp to a sane 1–100% band; NaN falls back to 80
		write: (input: number) => {
			const pct = Math.floor(input);
			return Number.isFinite(pct) ? Math.min(100, Math.max(1, pct)) : 80;
		}
	},
	budgetAlertEmail: {
		fallback: null,
		write: (input: string | null) => input?.trim() || null
	},
	tracingEnabled: { fallback: false },
	tracingRetentionDays: {
		fallback: 30,
		// at least 1 day; NaN falls back to the 30-day default
		write: (input: number) => {
			const days = Math.floor(input);
			return Number.isFinite(days) ? Math.max(1, days) : 30;
		}
	},
	ssoSignupEnabled: { fallback: true }
};

const FIELD_KEYS = Object.keys(FIELDS) as (keyof Settings)[];

/** Map a (possibly missing) settings row to {@link Settings}, applying defaults. */
function fromRow(row: typeof settings.$inferSelect | undefined): Settings {
	const out: Record<string, unknown> = {};
	for (const key of FIELD_KEYS) {
		const { fallback, read } = FIELDS[key];
		const stored = row?.[key];
		out[key] = stored == null ? fallback : read ? read(stored as never) : stored;
	}
	return out as unknown as Settings;
}

/**
 * How long a settings read is served from memory. getSettings runs on most
 * requests (every permission check, token resolution, trace pruning), while the
 * row changes only from the settings page. Writes through {@link updateSettings}
 * invalidate immediately; the TTL only bounds how stale another process can be.
 */
const SETTINGS_TTL_MS = 5_000;

let cachedSettings: { value: Settings; expires: number } | undefined;

/** Drop the cached settings so the next read goes to the database. */
export function invalidateSettingsCache(): void {
	cachedSettings = undefined;
}

/**
 * Read instance settings, falling back to defaults when no row exists yet.
 * Served from a short-lived in-memory cache (see {@link SETTINGS_TTL_MS}); each
 * call returns its own copy, so callers may mutate the result freely.
 */
export async function getSettings(): Promise<Settings> {
	if (!cachedSettings || cachedSettings.expires <= Date.now()) {
		const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
		cachedSettings = { value: fromRow(row), expires: Date.now() + SETTINGS_TTL_MS };
	}
	return { ...cachedSettings.value };
}

/**
 * Upsert instance gateway settings. Only the fields present in `input` are
 * written, so callers can update the cache TTL and the member-permission
 * toggles independently.
 */
export async function updateSettings(input: Partial<Settings>) {
	const set: Record<string, unknown> = {};
	for (const key of FIELD_KEYS) {
		const value = input[key];
		if (value === undefined) continue;
		const { write } = FIELDS[key];
		set[key] = write ? write(value as never) : value;
	}
	const values = set as Partial<typeof settings.$inferInsert>;
	await db
		.insert(settings)
		.values({ id: 1, ...values })
		.onConflictDoUpdate({
			target: settings.id,
			set: values
		});
	invalidateSettingsCache();
}
