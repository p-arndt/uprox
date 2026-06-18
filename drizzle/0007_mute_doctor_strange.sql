ALTER TABLE "request_trace" ADD COLUMN "trace_group_id" text;--> statement-breakpoint
CREATE INDEX "request_trace_group_idx" ON "request_trace" USING btree ("trace_group_id");