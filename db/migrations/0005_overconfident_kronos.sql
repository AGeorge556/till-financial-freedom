CREATE TYPE "public"."goal_target_mode" AS ENUM('manual', 'expense_months');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_amount_check" CHECK ("budgets"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" bigint NOT NULL,
	"category_id" uuid,
	"account_id" uuid NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"auto_post" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_templates_type_check" CHECK ("recurring_templates"."type" in ('INCOME', 'EXPENSE')),
	CONSTRAINT "recurring_templates_amount_check" CHECK ("recurring_templates"."amount" > 0),
	CONSTRAINT "recurring_templates_dates_check" CHECK ("recurring_templates"."end_date" is null or "recurring_templates"."end_date" >= "recurring_templates"."start_date")
);
--> statement-breakpoint
ALTER TABLE "recurring_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_mode" "goal_target_mode" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_months" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_template_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_due_date" date;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "budget_warn_at" numeric(4, 3) DEFAULT '0.8' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "budget_alert_at" numeric(4, 3) DEFAULT '1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_category_idx" ON "budgets" USING btree ("user_id","category_id") WHERE "budgets"."category_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_one_overall_idx" ON "budgets" USING btree ("user_id") WHERE "budgets"."category_id" is null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_template_id_recurring_templates_id_fk" FOREIGN KEY ("recurring_template_id") REFERENCES "public"."recurring_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recurring_occurrence_idx" ON "transactions" USING btree ("recurring_template_id","recurring_due_date");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_mode_check" CHECK (("goals"."target_mode" = 'expense_months') = ("goals"."target_months" is not null)
        and ("goals"."target_months" is null or "goals"."target_months" between 1 and 60));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_check" CHECK (("transactions"."recurring_template_id" is null) = ("transactions"."recurring_due_date" is null));--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_budget_thresholds_check" CHECK (budget_warn_at > 0 and budget_warn_at <= budget_alert_at and budget_alert_at <= 2);--> statement-breakpoint
CREATE POLICY "budgets_owner_all" ON "budgets" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "recurring_templates_owner_all" ON "recurring_templates" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));