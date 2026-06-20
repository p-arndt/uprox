ALTER TABLE "machine_token" ADD COLUMN "allowed_providers" text[];--> statement-breakpoint
ALTER TABLE "machine_token" ADD COLUMN "preferred_provider" text;--> statement-breakpoint
ALTER TABLE "machine_token" ADD COLUMN "rate_limit_per_minute" integer;--> statement-breakpoint
ALTER TABLE "machine_token" ADD COLUMN "daily_budget_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "machine_token" ADD COLUMN "monthly_budget_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "machine_token" ADD COLUMN "cache_ttl_seconds" integer;--> statement-breakpoint
ALTER TABLE "machine_token" ADD COLUMN "tracing_enabled" boolean;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "allowed_providers" text[];--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "allowed_models" text[];--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preferred_provider" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "rate_limit_per_minute" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "daily_budget_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "monthly_budget_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "cache_ttl_seconds" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "tracing_enabled" boolean;