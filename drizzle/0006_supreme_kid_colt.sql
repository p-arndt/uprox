CREATE TABLE "request_trace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_log_id" uuid NOT NULL,
	"service_id" uuid,
	"request_body" text,
	"response_body" text,
	"response_format" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "tracing_enabled" boolean;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tracing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tracing_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "request_trace" ADD CONSTRAINT "request_trace_audit_log_id_audit_log_id_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_trace" ADD CONSTRAINT "request_trace_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_trace_audit_uidx" ON "request_trace" USING btree ("audit_log_id");--> statement-breakpoint
CREATE INDEX "request_trace_created_idx" ON "request_trace" USING btree ("created_at");