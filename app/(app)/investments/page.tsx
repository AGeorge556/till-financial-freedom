import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Investments" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Investments</h1>
      <div className="mt-6">
        <EmptyState
          accent="investments"
          title="No investments tracked yet"
          items={["Stocks", "Gold", "Savings Clouds"]}
        >
          Your stocks, gold and Savings Clouds will appear here.
        </EmptyState>
      </div>
    </>
  );
}
