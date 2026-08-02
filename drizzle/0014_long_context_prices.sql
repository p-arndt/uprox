-- Add the long-context rate card to model_price. A request whose prompt reaches
-- LONG_CONTEXT_MIN_PROMPT_TOKENS (see providers.ts) bills every token — input,
-- cache traffic and output — against these columns instead of the standard ones.
-- All nullable: a NULL long_input_per_mtok means the model has a single rate
-- card, which is how every non-OpenAI default and every pre-existing row starts.
-- Platform defaults are re-synced from the code list on server start, so the
-- built-in models pick their long rates up without a data migration here.
--
-- Hand-authored with IF NOT EXISTS guards so it applies cleanly whether the
-- schema was reached via migrate or already synced with `db:push`.
ALTER TABLE "model_price" ADD COLUMN IF NOT EXISTS "long_input_per_mtok" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "model_price" ADD COLUMN IF NOT EXISTS "long_output_per_mtok" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "model_price" ADD COLUMN IF NOT EXISTS "long_cache_read_per_mtok" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "model_price" ADD COLUMN IF NOT EXISTS "long_cache_write_per_mtok" numeric(12, 4);
