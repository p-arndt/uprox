-- Gateway requests that reported token usage but were stored without a cost
-- because their model had no price yet. The pricing page counts them per model
-- and offers to backfill their cost once a price exists; this partial index
-- keeps that lookup off the full audit_log and stays small once priced.
CREATE INDEX IF NOT EXISTS "audit_log_unpriced_idx" ON "audit_log" USING btree ("model") WHERE "audit_log"."cost_usd" is null and "audit_log"."input_tokens" is not null;
