CREATE TYPE "public"."allocation_rule_kind" AS ENUM('fixed', 'percentage', 'remainder');--> statement-breakpoint
CREATE TYPE "public"."allocation_target_kind" AS ENUM('goal', 'investments', 'cash');--> statement-breakpoint
CREATE TYPE "public"."savings_target_mode" AS ENUM('fixed', 'percentage', 'flexible');--> statement-breakpoint
CREATE TABLE "allocation_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_overrides_rule_month_unique" UNIQUE("rule_id","month"),
	CONSTRAINT "allocation_overrides_month_check" CHECK ("allocation_overrides"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "allocation_overrides_amount_check" CHECK ("allocation_overrides"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "allocation_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "allocation_rule_kind" NOT NULL,
	"target_kind" "allocation_target_kind" NOT NULL,
	"goal_id" uuid,
	"amount" bigint,
	"percent" numeric(8, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_rules_goal_target_check" CHECK (("allocation_rules"."goal_id" is not null) = ("allocation_rules"."target_kind" = 'goal')),
	CONSTRAINT "allocation_rules_kind_values_check" CHECK ((
        "allocation_rules"."kind" = 'fixed' and "allocation_rules"."amount" is not null and "allocation_rules"."amount" > 0 and "allocation_rules"."percent" is null
      ) or (
        "allocation_rules"."kind" = 'percentage' and "allocation_rules"."percent" is not null and "allocation_rules"."percent" > 0 and "allocation_rules"."percent" <= 1 and "allocation_rules"."amount" is null
      ) or (
        "allocation_rules"."kind" = 'remainder' and "allocation_rules"."amount" is null and "allocation_rules"."percent" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "allocation_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goal_allocation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"delta" bigint NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_allocation_events_delta_check" CHECK ("goal_allocation_events"."delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goal_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_allocations_goal_account_unique" UNIQUE("goal_id","account_id"),
	CONSTRAINT "goal_allocations_amount_check" CHECK ("goal_allocations"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "goal_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_amount" bigint NOT NULL,
	"target_date" date NOT NULL,
	"start_date" date NOT NULL,
	"priority" integer NOT NULL,
	"planned_monthly" bigint,
	"expected_return_override" numeric(8, 6),
	"manual_current" bigint,
	"notes" text,
	"color" text,
	"icon" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_target_amount_check" CHECK ("goals"."target_amount" > 0),
	CONSTRAINT "goals_priority_check" CHECK ("goals"."priority" >= 1),
	CONSTRAINT "goals_planned_monthly_check" CHECK ("goals"."planned_monthly" is null or "goals"."planned_monthly" >= 0),
	CONSTRAINT "goals_manual_current_check" CHECK ("goals"."manual_current" is null or "goals"."manual_current" >= 0)
);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "savings_target_mode" "savings_target_mode" DEFAULT 'flexible' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "savings_target_amount" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "savings_target_percent" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "expected_monthly_income" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "expected_monthly_spending" bigint;--> statement-breakpoint
ALTER TABLE "allocation_overrides" ADD CONSTRAINT "allocation_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_overrides" ADD CONSTRAINT "allocation_overrides_rule_id_allocation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."allocation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ADD CONSTRAINT "goal_allocation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ADD CONSTRAINT "goal_allocation_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocation_events" ADD CONSTRAINT "goal_allocation_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD CONSTRAINT "goal_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD CONSTRAINT "goal_allocations_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_allocations" ADD CONSTRAINT "goal_allocations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_rules_one_remainder_idx" ON "allocation_rules" USING btree ("user_id") WHERE "allocation_rules"."kind" = 'remainder';--> statement-breakpoint
CREATE INDEX "goal_allocation_events_user_date_idx" ON "goal_allocation_events" USING btree ("user_id","date");--> statement-breakpoint
CREATE POLICY "allocation_overrides_owner_all" ON "allocation_overrides" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "allocation_rules_owner_all" ON "allocation_rules" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "goal_allocation_events_owner_all" ON "goal_allocation_events" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "goal_allocations_owner_all" ON "goal_allocations" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "goals_owner_all" ON "goals" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));