CREATE TABLE "rate_limit_window" (
	"token_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limit_window_token_id_window_start_pk" PRIMARY KEY("token_id","window_start")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "rate_limit_window" ADD CONSTRAINT "rate_limit_window_token_id_machine_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."machine_token"("id") ON DELETE cascade ON UPDATE no action;