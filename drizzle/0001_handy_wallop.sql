CREATE TABLE "response_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"status_code" integer NOT NULL,
	"response" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "daily_budget_usd" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "monthly_budget_usd" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "cache_ttl_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "response_cache" ADD CONSTRAINT "response_cache_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "response_cache_org_key_uidx" ON "response_cache" USING btree ("organization_id","cache_key");--> statement-breakpoint
CREATE INDEX "response_cache_expires_idx" ON "response_cache" USING btree ("expires_at");