import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Goals" };

export default function Page() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Goals</h1>
      <div className="mt-6">
        <EmptyState accent="goals" title="No goals yet" items={["Targets", "Progress"]}>
          The goals you set, and your progress towards each, will appear here.
        </EmptyState>
      </div>
    </>
  );
}
