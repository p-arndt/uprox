ALTER TABLE "audit_log" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_price" ADD COLUMN "cache_read_per_mtok" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "model_price" ADD COLUMN "cache_write_per_mtok" numeric(12, 4);