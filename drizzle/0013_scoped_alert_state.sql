-- Generalize budget_alert_state from service-keyed to scope-keyed
-- (scope, scope_id, window), so the dedup ledger covers both the per-service and
-- the instance-wide budget alerts. See budget-alerts.ts.
--
-- Hand-authored: drizzle-kit generate needs an interactive TTY to resolve the
-- service_id → scope/scope_id change. IF EXISTS / IF NOT EXISTS guards keep it
-- idempotent so it applies cleanly whether the schema was reached via migrate
-- or already synced with `db:push`. Alert state is ephemeral dedup data, so
-- clearing it costs at most one duplicate alert email per window.
DROP INDEX IF EXISTS "budget_alert_state_service_window_uidx";--> statement-breakpoint
ALTER TABLE "budget_alert_state" DROP CONSTRAINT IF EXISTS "budget_alert_state_service_id_service_id_fk";--> statement-breakpoint
DELETE FROM "budget_alert_state";--> statement-breakpoint
ALTER TABLE "budget_alert_state" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_alert_state" ADD COLUMN IF NOT EXISTS "scope_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_alert_state" DROP COLUMN IF EXISTS "service_id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_alert_state_scope_window_uidx" ON "budget_alert_state" USING btree ("scope","scope_id","window");
