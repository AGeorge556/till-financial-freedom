import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Spending" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Spending</h1>
      <div className="mt-6">
        <EmptyState accent="spending" title="No spending tracked yet" items={["Transactions", "Budgets"]}>
          Your transactions and monthly budgets will appear here.
        </EmptyState>
      </div>
    </>
  );
}
