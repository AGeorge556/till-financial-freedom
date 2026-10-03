import type { Metadata } from "next";
import Link from "next/link";
import { BudgetForm, BudgetThresholdsForm } from "@/components/BudgetForms";
import { BackLink, card } from "@/components/ui";
import { getBudgetThresholds, listBudgets, listCategories } from "@/db/queries";
import { requireUserId } from "@/lib/auth";

export const metadata: Metadata = { title: "Budgets" };

/** 0.8 -> "80", 0.825 -> "82.5": what a person types back in. */
const percentText = (fraction: number) => String(Math.round(fraction * 1000) / 10);

export default async function Page() {
  const userId = await requireUserId();
  const [budgets, categories, { warnAt, alertAt }] = await Promise.all([
    listBudgets(userId),
    listCategories(userId, { includeArchived: true }),
    getBudgetThresholds(userId),
  ]);
  const overall = budgets.find((b) => b.categoryId === null) ?? null;
  const byCategory = new Map(budgets.flatMap((b) => (b.categoryId ? [[b.categoryId, b] as const] : [])));
  // An archived category stays listed while it still has a budget, so that budget can be changed or removed.
  const expense = categories.filter((c) => c.kind === "expense" && (c.archivedAt === null || byCategory.has(c.id)));

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Budgets</h1>
      <p className="mt-1 text-muted">
        A budget is what you plan to spend each month. It stays the same every month until you change it, and{" "}
        <Link href="/spending" className="underline">
          Spending
        </Link>{" "}
        shows how you are doing.
      </p>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Everything you spend</h2>
        <div className={`p-5 ${card}`}>
          <BudgetForm
            categoryId={null}
            label="Monthly budget for all spending (EGP)"
            current={overall && { id: overall.id, amount: overall.amount }}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">By category</h2>
        {expense.length === 0 ? (
          <p className="text-muted">
            You have no spending categories yet.{" "}
            <Link href="/more/categories" className="underline">
              Add one
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {expense.map((c) => {
              const budget = byCategory.get(c.id);
              return (
                <li key={c.id} className="p-4">
                  <BudgetForm
                    categoryId={c.id}
                    label={`${c.name}${c.archivedAt ? " (archived)" : ""} (EGP a month)`}
                    current={budget ? { id: budget.id, amount: budget.amount } : null}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Warning levels</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            You get a warning once this share of a budget is spent, and an alert at the second level. Spending also flags a
            budget that is on track to go over before it happens.
          </p>
          <BudgetThresholdsForm warn={percentText(warnAt)} alert={percentText(alertAt)} />
        </div>
      </section>
    </>
  );
}
