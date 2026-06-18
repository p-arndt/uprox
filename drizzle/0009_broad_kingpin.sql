ALTER TABLE "machine_token" ADD COLUMN "encrypted_token" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tokens_recopyable_default" boolean DEFAULT false NOT NULL;