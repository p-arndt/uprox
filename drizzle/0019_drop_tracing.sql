DROP TABLE "request_trace" CASCADE;--> statement-breakpoint
DROP TABLE "trace_span" CASCADE;--> statement-breakpoint
ALTER TABLE "machine_token" DROP COLUMN "tracing_enabled";--> statement-breakpoint
ALTER TABLE "policy" DROP COLUMN "tracing_enabled";--> statement-breakpoint
ALTER TABLE "service" DROP COLUMN "tracing_enabled";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "tracing_enabled";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "tracing_retention_days";