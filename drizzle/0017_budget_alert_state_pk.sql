-- Give budget_alert_state a primary key on (scope, scope_id, window), replacing
-- the unique index on the same columns. Existing rows cannot violate it: the
-- unique index already enforced uniqueness and every key column is NOT NULL, so
-- no dedupe step is needed. The key is added before the index is dropped so the
-- ledger is never without a uniqueness guarantee.
ALTER TABLE "budget_alert_state" ADD CONSTRAINT "budget_alert_state_scope_scope_id_window_pk" PRIMARY KEY("scope","scope_id","window");--> statement-breakpoint
DROP INDEX "budget_alert_state_scope_window_uidx";
