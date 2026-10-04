import type { Metadata } from "next";
import { ScenarioCalculator } from "@/components/ScenarioCalculator";
import { BackLink } from "@/components/ui";
import { loadScenarioDefaults } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { loadGoalData } from "../../goals/data";

export const metadata: Metadata = { title: "What if" };

export default async function Page() {
  const userId = await requireUserId();
  const defaults = await loadScenarioDefaults(userId, { goalData: await loadGoalData(userId) });

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">What if</h1>
      <p className="mt-1 text-muted">
        Try a different income, saving or return and see where it leads. It starts from your own numbers and changes nothing in
        your data.
      </p>
      <ScenarioCalculator
        initial={defaults.input}
        basis={defaults.basis}
        inputsMissing={defaults.inputsMissing}
        returnsMissing={defaults.returnsMissing}
        stale={defaults.stale}
      />
    </>
  );
}
