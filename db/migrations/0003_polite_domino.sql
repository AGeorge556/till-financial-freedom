CREATE TYPE "public"."corporate_action_kind" AS ENUM('BONUS', 'SPLIT', 'WRITE_OFF');--> statement-breakpoint
CREATE TYPE "public"."holding_kind" AS ENUM('stock', 'fund', 'other');--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"kind" "corporate_action_kind" NOT NULL,
	"date" date NOT NULL,
	"quantity" numeric(20, 6),
	"ratio" numeric(20, 6),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_actions_kind_values_check" CHECK ((
        "corporate_actions"."kind" = 'BONUS' and "corporate_actions"."quantity" is not null and "corporate_actions"."quantity" > 0 and "corporate_actions"."ratio" is null
      ) or (
        "corporate_actions"."kind" = 'SPLIT' and "corporate_actions"."ratio" is not null and "corporate_actions"."ratio" > 0 and "corporate_actions"."quantity" is null
      ) or (
        "corporate_actions"."kind" = 'WRITE_OFF' and "corporate_actions"."quantity" is null and "corporate_actions"."ratio" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "holding_kind" NOT NULL,
	"name" text NOT NULL,
	"ticker" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"holding_id" uuid NOT NULL,
	"date" date NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_updates_price_check" CHECK ("price_updates"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "price_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "holding_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "quantity" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "unit_price" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "stale_days_holdings" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_updates" ADD CONSTRAINT "price_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_updates" ADD CONSTRAINT "price_updates_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporate_actions_holding_date_idx" ON "corporate_actions" USING btree ("holding_id","date");--> statement-breakpoint
CREATE INDEX "price_updates_holding_date_idx" ON "price_updates" USING btree ("holding_id","date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_holding_type_check" CHECK ("transactions"."holding_id" is null or "transactions"."type" in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE', 'DIVIDEND'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_quantity_price_check" CHECK ((
        "transactions"."type" in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE') and "transactions"."holding_id" is not null
          and "transactions"."quantity" is not null and "transactions"."quantity" > 0
          and "transactions"."unit_price" is not null and "transactions"."unit_price" >= 0
      ) or (
        ("transactions"."type" not in ('INVESTMENT_PURCHASE', 'INVESTMENT_SALE') or "transactions"."holding_id" is null)
          and "transactions"."quantity" is null and "transactions"."unit_price" is null
      ));--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_stale_days_holdings_range" CHECK (stale_days_holdings between 1 and 365);--> statement-breakpoint
CREATE POLICY "corporate_actions_owner_all" ON "corporate_actions" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "holdings_owner_all" ON "holdings" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "price_updates_owner_all" ON "price_updates" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));