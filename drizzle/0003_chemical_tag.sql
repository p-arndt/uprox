DROP INDEX "provider_secret_provider_uidx";--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "provider_secret_id" uuid;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_provider_secret_id_provider_secret_id_fk" FOREIGN KEY ("provider_secret_id") REFERENCES "public"."provider_secret"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_secret_provider_idx" ON "provider_secret" USING btree ("provider");