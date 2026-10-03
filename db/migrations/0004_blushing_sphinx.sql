CREATE TYPE "public"."contribution_frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."gold_form" AS ENUM('bar', 'coin', 'jewelry');--> statement-breakpoint
CREATE TYPE "public"."gold_price_mode" AS ENUM('derive_24k', 'per_karat');--> statement-breakpoint
CREATE TYPE "public"."liability_kind" AS ENUM('loan', 'owed', 'other');--> statement-breakpoint
ALTER TYPE "public"."holding_kind" ADD VALUE 'gold';--> statement-breakpoint
ALTER TYPE "public"."holding_kind" ADD VALUE 'cloud';--> statement-breakpoint
CREATE TABLE "cloud_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_confirmations_value_check" CHECK ("cloud_confirmations"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cloud_confirmations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gold_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"karat" integer NOT NULL,
	"buyback_price" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_prices_karat_check" CHECK ("gold_prices"."karat" in (24, 21, 18)),
	CONSTRAINT "gold_prices_price_check" CHECK ("gold_prices"."buyback_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gold_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "liability_kind" NOT NULL,
	"opening_balance" bigint NOT NULL,
	"interest_rate" numeric(8, 6),
	"start_date" date NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liabilities_opening_balance_check" CHECK ("liabilities"."opening_balance" > 0),
	CONSTRAINT "liabilities_interest_rate_check" CHECK ("liabilities"."interest_rate" is null or "liabilities"."interest_rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "liabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "liability_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"liability_id" uuid NOT NULL,
	"date" date NOT NULL,
	"delta" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liability_updates_delta_check" CHECK ("liability_updates"."delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "liability_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"apy" numeric(8, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_history_apy_check" CHECK ("rate_history"."apy" > -1)
);
--> statement-breakpoint
ALTER TABLE "rate_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goal_allocations" DROP CONSTRAINT "goal_allocations_amount_check";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_quantity_price_check";--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_allocations" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_allocations" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ADD COLUMN "holding_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ADD COLUMN "percent_delta" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD COLUMN "holding_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD COLUMN "percent" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "karat" integer;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "form" "gold_form";--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "maturity_date" date;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "contribution_amount" bigint;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "contribution_frequency" "contribution_frequency";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "liability_id" uuid;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "gold_price_mode" "gold_price_mode" DEFAULT 'derive_24k' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "stale_days_gold" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "stale_days_clouds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "cloud_confirmations" ADD CONSTRAINT "cloud_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_confirmations" ADD CONSTRAINT "cloud_confirmations_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_prices" ADD CONSTRAINT "gold_prices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liability_updates" ADD CONSTRAINT "liability_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liability_updates" ADD CONSTRAINT "liability_updates_liability_id_liabilities_id_fk" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_history" ADD CONSTRAINT "rate_history_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cloud_confirmations_holding_date_idx" ON "cloud_confirmations" USING btree ("holding_id","date");--> statement-breakpoint
CREATE INDEX "gold_prices_user_karat_date_idx" ON "gold_prices" USING btree ("user_id","karat","date");--> statement-breakpoint
CREATE INDEX "liability_updates_liability_date_idx" ON "liability_updates" USING btree ("liability_id","date");--> statement-breakpoint
CREATE INDEX "rate_history_holding_date_idx" ON "rate_history" USING btree ("holding_id","effective_date");--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ADD CONSTRAINT "goal_allocation_events_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD CONSTRAINT "goal_allocations_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_liability_id_liabilities_id_fk" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD CONSTRAINT "goal_allocations_goal_holding_unique" UNIQUE("goal_id","holding_id");--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ADD CONSTRAINT "goal_allocation_events_shape_check" CHECK ((
        "goal_allocation_events"."account_id" is not null and "goal_allocation_events"."holding_id" is null and "goal_allocation_events"."percent_delta" is null
      ) or (
        "goal_allocation_events"."holding_id" is not null and "goal_allocation_events"."account_id" is null and "goal_allocation_events"."percent_delta" is not null and "goal_allocation_events"."percent_delta" <> 0
      ));--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD CONSTRAINT "goal_allocations_shape_check" CHECK ((
        "goal_allocations"."account_id" is not null and "goal_allocations"."amount" is not null and "goal_allocations"."amount" > 0
          and "goal_allocations"."holding_id" is null and "goal_allocations"."percent" is null
      ) or (
        "goal_allocations"."holding_id" is not null and "goal_allocations"."percent" is not null and "goal_allocations"."percent" > 0 and "goal_allocations"."percent" <= 1
          and "goal_allocations"."account_id" is null and "goal_allocations"."amount" is null
      ));--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_gold_fields_check" CHECK (("holdings"."kind"::text = 'gold' and "holdings"."karat" in (24, 21, 18) and "holdings"."form" is not null)
        or ("holdings"."kind"::text <> 'gold' and "holdings"."karat" is null and "holdings"."form" is null));--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_cloud_fields_check" CHECK ("holdings"."kind"::text = 'cloud' or (
        "holdings"."start_date" is null and "holdings"."maturity_date" is null
        and "holdings"."contribution_amount" is null and "holdings"."contribution_frequency" is null
      ));--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_cloud_values_check" CHECK (("holdings"."maturity_date" is null or "holdings"."start_date" is null or "holdings"."maturity_date" >= "holdings"."start_date")
        and ("holdings"."contribution_amount" is null) = ("holdings"."contribution_frequency" is null)
        and ("holdings"."contribution_amount" is null or "holdings"."contribution_amount" > 0));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_liability_type_check" CHECK ("transactions"."liability_id" is null or "transactions"."type" in ('LIABILITY_PAYMENT', 'EXPENSE'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_quantity_price_check" CHECK ((
        "transactions"."type" in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE') and "transactions"."holding_id" is not null
          and (
            ("transactions"."quantity" is not null and "transactions"."quantity" > 0 and "transactions"."unit_price" is not null and "transactions"."unit_price" >= 0)
            or ("transactions"."quantity" is null and "transactions"."unit_price" is null)
          )
      ) or (
        ("transactions"."type" not in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE') or "transactions"."holding_id" is null)
          and "transactions"."quantity" is null and "transactions"."unit_price" is null
      ));--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_stale_days_gold_range" CHECK (stale_days_gold between 1 and 365);--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_stale_days_clouds_range" CHECK (stale_days_clouds between 1 and 365);--> statement-breakpoint
CREATE POLICY "cloud_confirmations_owner_all" ON "cloud_confirmations" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "gold_prices_owner_all" ON "gold_prices" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "liabilities_owner_all" ON "liabilities" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "liability_updates_owner_all" ON "liability_updates" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "rate_history_owner_all" ON "rate_history" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));