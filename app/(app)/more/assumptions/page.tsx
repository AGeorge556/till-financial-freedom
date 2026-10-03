import type { Metadata } from "next";
import { ratePercentText } from "@/components/GoalFormat";
import { BackLink, card } from "@/components/ui";
import { getAssumptions, getWealthSettings } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { AssumptionsForm, GoldModeForm, StaleDaysCloudsForm, StaleDaysForm, StaleDaysGoldForm } from "./AssumptionsForms";

export const metadata: Metadata = { title: "Assumptions" };

export default async function Page() {
  const userId = await requireUserId();
  const [a, w] = await Promise.all([getAssumptions(userId), getWealthSettings(userId)]);

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
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Gold prices</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            Gold is valued at the buy-back price per gram, what a jeweler would pay you. Changing this keeps every price you
            already entered.
          </p>
          <GoldModeForm mode={w.goldPriceMode} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Old values</h2>
        <div className={`space-y-8 p-5 ${card}`}>
          <p className="text-sm text-muted">
            You type in prices and confirmed values yourself, so they age. A value is marked stale when it is older than these.
          </p>
          <StaleDaysForm days={w.staleDaysHoldings} />
          <StaleDaysGoldForm days={w.staleDaysGold} />
          <StaleDaysCloudsForm days={w.staleDaysClouds} />
        </div>
      </section>
    </>
  );
}
