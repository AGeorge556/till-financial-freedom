import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = { title: "More" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">More</h1>
      <div className="mt-6">
        <EmptyState
          accent="cash"
          title="Nothing set up yet"
          items={["Accounts", "Income", "Reports", "Scenarios", "Settings"]}
        >
          Accounts, income, reports, scenarios and settings will live here.
        </EmptyState>
      </div>
    </>
  );
}
