import type { Metadata } from "next";
import { signOut } from "@/app/login/actions";
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
      <form action={signOut} className="mt-6">
        <button type="submit" className="min-h-11 w-full rounded-xl border border-border px-4 font-medium">
          Sign out
        </button>
      </form>
    </>
  );
}
