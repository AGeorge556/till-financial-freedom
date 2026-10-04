import { loadReminders } from "@/app/(app)/more/reminders/data";
import { listUsersWithPush } from "@/db/queries";
import { pushSummary } from "@/lib/finance-core/reminders";
import { pushConfigured, sendToUser } from "@/lib/push";
import { bearerMatches } from "@/lib/pushInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily push of the reminders (vercel.json). The one place that acts for a user without that user's session, so the
 * secret below is its only gate (proxy.ts lets this path through). It reads that user's data and writes nothing but
 * the subscription bookkeeping in lib/push.ts. The answer holds counts only.
 */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!pushConfigured()) return new Response("Push notifications are not configured", { status: 503 });

  let checked = 0;
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const userId of await listUsersWithPush()) {
    checked++;
    try {
      const summary = pushSummary(await loadReminders(userId));
      if (!summary) continue;
      const result = await sendToUser(userId, { ...summary, url: "/" });
      if (result.configured) {
        sent += result.sent;
        removed += result.removed;
      }
    } catch {
      // One person's failure must not stop the rest. The error is not logged: a database error can quote row values.
      failed++;
    }
  }
  return Response.json({ checked, sent, removed, failed }, { headers: { "Cache-Control": "no-store" } });
}
