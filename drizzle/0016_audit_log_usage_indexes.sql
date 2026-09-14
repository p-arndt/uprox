-- Indexes for the usage analytics and budget enforcement read paths.
--
-- Hand-edited after `drizzle-kit generate`: the INCLUDE lists cannot be
-- expressed in the drizzle schema, so the snapshot only records the key columns
-- and the WHERE clause. They let the window scans and budget sums be answered
-- by index-only scans instead of heap lookups.
--
-- IF NOT EXISTS keeps this idempotent for databases synced with `db:push`.
CREATE INDEX IF NOT EXISTS "audit_log_gateway_created_idx" ON "audit_log" USING btree ("created_at") INCLUDE ("service_id","token_id","model","provider","status","context_tier","cost_usd","input_tokens","output_tokens") WHERE "audit_log"."action" like 'gateway.%';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_service_created_idx" ON "audit_log" USING btree ("service_id","created_at") INCLUDE ("cost_usd");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_token_created_idx" ON "audit_log" USING btree ("token_id","created_at") INCLUDE ("cost_usd");
