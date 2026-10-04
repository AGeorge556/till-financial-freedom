ALTER TABLE "cloud_confirmations" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gold_prices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "liability_updates" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_updates" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rate_history" ADD COLUMN "voided_at" timestamp with time zone;