ALTER TABLE "audit_log" ADD COLUMN "saved_usd" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "response_cache" ADD COLUMN "cost_usd" numeric(12, 6);