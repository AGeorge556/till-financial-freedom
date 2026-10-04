import type { Metadata } from "next";
import { egpText, ratePercentText } from "@/components/GoalFormat";
import { InsightThresholdsForm } from "@/components/InsightForms";
import { PushSettings } from "@/components/PushSettings";
import { ReminderSwitchesForm } from "@/components/ReminderForms";
import { BackLink, card } from "@/components/ui";
import { getInsightThresholds, getReminderSwitches } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { pushConfigured } from "@/lib/push";

export const metadata: Metadata = { title: "Reminders and insights" };

export default async function Page() {
  const userId = await requireUserId();
  const [on, thresholds] = await Promise.all([getReminderSwitches(userId), getInsightThresholds(userId)]);
  // The card needs the whole key set; without it nothing about notifications is shown.
  const publicKey = pushConfigured() ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY : undefined;

  return (
    <>
      <BackLink href="/more">More</BackLink>
      <h1 className="text-3xl font-semibold tracking-tight">Reminders and insights</h1>
      <p className="mt-1 text-muted">
        Reminders show on Home when something needs you.
        {publicKey ? " You can also get one notification a day on this device." : " Nothing is sent to your phone."}
      </p>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Reminders</h2>
        <div className={`px-5 py-2 ${card}`}>
          <ReminderSwitchesForm on={on} />
        </div>
      </section>

      {publicKey && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">Notifications on this device</h2>
          <div className={`p-5 ${card}`}>
            <PushSettings publicKey={publicKey} />
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Insights</h2>
        <div className={`p-5 ${card}`}>
          <p className="mb-4 text-sm text-muted">
            A change in spending is only shown when it is at least this much in percent and at least this much in EGP. This
            keeps small ups and downs out of your way.
          </p>
          <InsightThresholdsForm percent={ratePercentText(thresholds.percent)} amount={egpText(thresholds.amount)} />
        </div>
      </section>
    </>
  );
}
