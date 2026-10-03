import type { Metadata } from "next";
import { BackLink, card } from "@/components/ui";
import { listCategories } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { AddCategoryForm, CategoryRow } from "./CategoryForms";

export const metadata: Metadata = { title: "Categories" };

export default async function Page() {
  const userId = await requireUserId();
  const categories = await listCategories(userId, { includeArchived: true });

  const sections = (["expense", "income"] as const).map((kind) => ({
    kind,
    title: kind === "expense" ? "Spending categories" : "Income categories",
    active: categories.filter((c) => c.kind === kind && c.archivedAt === null),
    archived: categories.filter((c) => c.kind === kind && c.archivedAt !== null),
  }));

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Categories</h1>

      {sections.map(({ kind, title, active, archived }) => (
        <section key={kind} className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">{title}</h2>
          {active.length === 0 ? (
            <p className="text-muted">None yet. Add one below.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {active.map((c) => (
                <li key={c.id}>
                  <CategoryRow id={c.id} name={c.name} isEssential={c.isEssential} isExpense={kind === "expense"} />
                </li>
              ))}
            </ul>
          )}
          {archived.length > 0 && (
            <p className="mt-2 text-sm text-muted">Archived: {archived.map((c) => c.name).join(", ")}</p>
          )}
        </section>
      ))}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Add a category</h2>
        <div className={`p-5 ${card}`}>
          <AddCategoryForm />
        </div>
      </section>
    </>
  );
}
