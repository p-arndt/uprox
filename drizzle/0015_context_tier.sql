-- Record which context tier a gateway request billed against, so the cost
-- analysis can slice spend by it. A model with a long-context rate card bills
-- its *whole* request (input, cache traffic and output) at 2×/1.5× once the
-- prompt reaches LONG_CONTEXT_MIN_PROMPT_TOKENS — see providers.ts — which
-- otherwise shows up as an unexplained jump in the totals.
--
-- Values are 'standard' and 'long'. NULL means nothing was priced (a denial, an
-- error, an unpriced model), which is why the column stays nullable rather than
-- defaulting to 'standard'.
--
-- Hand-authored with an IF NOT EXISTS guard so it applies cleanly whether the
-- schema was reached via migrate or already synced with `db:push`.
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "context_tier" text;--> statement-breakpoint
-- Backfill the rows that were priced. The tier is a pure function of the prompt
-- size and the model's rate card, so history can be reconstructed exactly: take
-- the price row that wins the longest-prefix match the runtime lookup uses
-- (custom overrides ahead of platform defaults on equal length), and call it
-- long only if that row actually has a long card. Without the prefix lookup a
-- model like gpt-5.4-mini — single-card, but prefixed by the long-carded
-- gpt-5.4 — would be mislabelled.
UPDATE "audit_log" a
SET "context_tier" = CASE
	WHEN a."input_tokens" >= 272000
		AND (
			SELECT p."long_input_per_mtok"
			FROM "model_price" p
			WHERE starts_with(lower(a."model"), p."model")
			ORDER BY length(p."model") DESC, p."is_default" ASC
			LIMIT 1
		) IS NOT NULL
	THEN 'long'
	ELSE 'standard'
END
WHERE a."cost_usd" IS NOT NULL AND a."model" IS NOT NULL AND a."context_tier" IS NULL;
