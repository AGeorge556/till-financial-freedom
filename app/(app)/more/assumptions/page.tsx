import type { Metadata } from "next";
import { ratePercentText } from "@/components/GoalFormat";
import { BackLink, card } from "@/components/ui";
import { getAssumptions, getStaleDays } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { AssumptionsForm, StaleDaysForm } from "./AssumptionsForms";

export const metadata: Metadata = { title: "Assumptions" };

export default async function Page() {
  const userId = await requireUserId();
  const [a, staleDays] = await Promise.all([getAssumptions(userId), getStaleDays(userId)]);

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Assumptions</h1>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Expected returns</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            These are your own guesses, expected / assumed, not guaranteed. Nothing is filled in for you, and a blank one
            is simply not used.
          </p>
          <AssumptionsForm
            values={{
              stockReturn: ratePercentText(a.stockReturn),
              goldReturn: ratePercentText(a.goldReturn),
              savingsCloudApy: ratePercentText(a.savingsCloudApy),
              cashReturn: ratePercentText(a.cashReturn),
              inflation: ratePercentText(a.inflation),
            }}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Old prices</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            You type in prices yourself, so they age. A holding is marked stale when its latest price is older than this.
          </p>
          <StaleDaysForm days={staleDays} />
        </div>
      </section>
    </>
  );
}
