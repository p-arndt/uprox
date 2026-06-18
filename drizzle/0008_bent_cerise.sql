CREATE TABLE "trace_span" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" text NOT NULL,
	"span_id" text NOT NULL,
	"parent_span_id" text,
	"name" text NOT NULL,
	"kind" text,
	"started_at" timestamp NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unset' NOT NULL,
	"service_name" text,
	"service_id" uuid,
	"attributes" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trace_span" ADD CONSTRAINT "trace_span_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trace_span_trace_span_uidx" ON "trace_span" USING btree ("trace_id","span_id");--> statement-breakpoint
CREATE INDEX "trace_span_trace_idx" ON "trace_span" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "trace_span_created_idx" ON "trace_span" USING btree ("created_at");