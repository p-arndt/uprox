CREATE TABLE "budget_alert_state" (
	"service_id" uuid NOT NULL,
	"window" text NOT NULL,
	"last_level" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "budget_alerts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "budget_alert_threshold_pct" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "budget_alert_email" text;--> statement-breakpoint
ALTER TABLE "budget_alert_state" ADD CONSTRAINT "budget_alert_state_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alert_state_service_window_uidx" ON "budget_alert_state" USING btree ("service_id","window");