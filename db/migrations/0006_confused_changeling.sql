ALTER TABLE "financial_assumptions" ADD COLUMN "income_growth" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "target_stocks" numeric(6, 5);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "target_gold" numeric(6, 5);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "target_clouds" numeric(6, 5);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "target_cash" numeric(6, 5);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "insight_min_percent" numeric(5, 4) DEFAULT '0.15' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "insight_min_amount" bigint DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_recurring" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_stale" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_goal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_budget" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "remind_savings" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_target_mix_check" CHECK ((target_stocks is null and target_gold is null and target_clouds is null and target_cash is null)
        or (target_stocks is not null and target_gold is not null and target_clouds is not null and target_cash is not null
          and target_stocks between 0 and 1 and target_gold between 0 and 1 and target_clouds between 0 and 1 and target_cash between 0 and 1
          and abs(target_stocks + target_gold + target_clouds + target_cash - 1) <= 0.00001));--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_insight_thresholds_check" CHECK (insight_min_percent >= 0 and insight_min_amount >= 0);