CREATE TABLE "org_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"cache_ttl_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy" ALTER COLUMN "cache_ttl_seconds" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "policy" ALTER COLUMN "cache_ttl_seconds" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;