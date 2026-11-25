-- Per-model threshold for the long-context rate card: the inclusive prompt size
-- (tokens) at which a request bills against the long_* columns. NULL keeps the
-- shared default (LONG_CONTEXT_MIN_PROMPT_TOKENS, OpenAI's 272k); Claude Haiku
-- 5.5, for one, flips for prompts over 100k (stored as 100001). Platform
-- defaults are re-synced on server start, so no data migration is needed.
--
-- IF NOT EXISTS so it applies cleanly whether the schema was reached via
-- migrate or already synced with `db:push`.
ALTER TABLE "model_price" ADD COLUMN IF NOT EXISTS "long_min_prompt_tokens" integer;
