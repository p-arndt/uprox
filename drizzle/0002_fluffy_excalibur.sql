ALTER TABLE "audit_log" ADD COLUMN "saved_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "saved_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "response_cache" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "response_cache" ADD COLUMN "output_tokens" integer;