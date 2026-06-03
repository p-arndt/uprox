ALTER TABLE "machine_token" ADD COLUMN "allowed_models" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "machine_token" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "machine_token" ADD CONSTRAINT "machine_token_policy_id_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policy"("id") ON DELETE set null ON UPDATE no action;