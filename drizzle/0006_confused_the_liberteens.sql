CREATE TABLE "model_price" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"model" text NOT NULL,
	"provider" text,
	"input_per_mtok" numeric(12, 4) NOT NULL,
	"output_per_mtok" numeric(12, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_price" ADD CONSTRAINT "model_price_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_price_default_uidx" ON "model_price" USING btree ("model") WHERE "model_price"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "model_price_org_uidx" ON "model_price" USING btree ("organization_id","model") WHERE "model_price"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "model_price_org_idx" ON "model_price" USING btree ("organization_id");--> statement-breakpoint
-- Seed platform-default model prices (NULL org). These are the values that were
-- previously hardcoded in providers.ts; the DB is now the single source of truth.
INSERT INTO "model_price" ("id", "organization_id", "model", "provider", "input_per_mtok", "output_per_mtok") VALUES
	(gen_random_uuid(), NULL, 'gpt-5.5-pro', 'openai', 30, 180),
	(gen_random_uuid(), NULL, 'gpt-5.5', 'openai', 5, 30),
	(gen_random_uuid(), NULL, 'gpt-5.4-pro', 'openai', 30, 180),
	(gen_random_uuid(), NULL, 'gpt-5.4-mini', 'openai', 0.75, 4.5),
	(gen_random_uuid(), NULL, 'gpt-5.4-nano', 'openai', 0.2, 1.25),
	(gen_random_uuid(), NULL, 'gpt-5.4', 'openai', 2.5, 15),
	(gen_random_uuid(), NULL, 'gpt-4o', 'openai', 2.5, 10),
	(gen_random_uuid(), NULL, 'gpt-4o-mini', 'openai', 0.15, 0.6),
	(gen_random_uuid(), NULL, 'gpt-4.1', 'openai', 2, 8),
	(gen_random_uuid(), NULL, 'gpt-4.1-mini', 'openai', 0.4, 1.6),
	(gen_random_uuid(), NULL, 'o3', 'openai', 2, 8),
	(gen_random_uuid(), NULL, 'claude-opus-4-7', 'anthropic', 5, 25),
	(gen_random_uuid(), NULL, 'claude-opus-4-6', 'anthropic', 5, 25),
	(gen_random_uuid(), NULL, 'claude-opus-4-5', 'anthropic', 5, 25),
	(gen_random_uuid(), NULL, 'claude-opus-4-1', 'anthropic', 15, 75),
	(gen_random_uuid(), NULL, 'claude-sonnet-4-6', 'anthropic', 3, 15),
	(gen_random_uuid(), NULL, 'claude-sonnet-4-5', 'anthropic', 3, 15),
	(gen_random_uuid(), NULL, 'claude-haiku-4-5', 'anthropic', 1, 5),
	(gen_random_uuid(), NULL, 'claude-3-5-sonnet', 'anthropic', 3, 15),
	(gen_random_uuid(), NULL, 'claude-3-5-haiku', 'anthropic', 0.8, 4),
	(gen_random_uuid(), NULL, 'claude-sonnet-4', 'anthropic', 3, 15)
ON CONFLICT ("model") WHERE "organization_id" IS NULL DO NOTHING;