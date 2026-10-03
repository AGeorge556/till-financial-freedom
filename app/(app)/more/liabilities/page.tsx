import type { Metadata } from "next";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { cairoToday } from "@/lib/finance-core/time";
import { AddLoanForm } from "@/components/LiabilityForms";
import { LiabilityList } from "@/components/LiabilityList";
import { BackLink, card } from "@/components/ui";
import { requireUserId } from "@/lib/auth";
import { loadLiabilities } from "./data";

export const metadata: Metadata = { title: "Loans" };

export default async function Page() {
  const userId = await requireUserId();
  const { views, total } = await loadLiabilities(userId);
  const active = views.filter((l) => !l.archivedAt);
  const archived = views.filter((l) => l.archivedAt);

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Loans</h1>

      {active.length === 0 ? (
        <div className="mt-6">
          <EmptyState accent="cash" title="No loans" items={["Loans", "Money you owe"]}>
            Add a loan or money you owe someone. What you owe is taken off your net worth. Credit cards stay in Accounts.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className={`mt-6 p-5 ${card}`}>
            <p className="text-sm text-muted">You owe in total</p>
            <Amount value={total} className="mt-1 block text-4xl font-semibold tracking-tight" />
            <p className="mt-2 text-sm text-muted">This is taken off your net worth.</p>
          </section>
          <div className="mt-6">
            <LiabilityList liabilities={active} />
          </div>
        </>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Add a loan</h2>
        <div className={`p-5 ${card}`}>
          <AddLoanForm today={cairoToday()} />
        </div>
      </section>

      {archived.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Paid off</h2>
          <LiabilityList liabilities={archived} muted />
        </section>
      )}
    </>
  );
}
