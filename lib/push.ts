import { parseSubscription } from "./pushInput";
import "server-only";
import webpush from "web-push";
import {
  deletePushSubscriptionById,
  listPushSubscriptions,
  recordPushFailure,
  recordPushSuccess,
} from "@/db/queries";

export type PushPayload = { title: string; body: string; url?: string };
export type PushResult = { configured: false } | { configured: true; sent: number; removed: number };

/** A device that failed this many sends in a row is dropped. */
const MAX_FAILURES = 5;
/** Seconds the push service keeps a message for a phone that is off or offline. */
const TTL = 12 * 60 * 60;

function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export const pushConfigured = () => vapid() !== null;

/**
 * Sends to every device of one user. Never logs or returns an endpoint or key. A 404 or 410 means the browser dropped
 * the subscription, so it is deleted. Any other answer from the push service counts as a failure; an error with no answer
 * (a network problem, a malformed key in the environment) is not the device's fault and counts for nothing.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<PushResult> {
  const details = vapid();
  if (!details) return { configured: false };

  // A notification payload is limited to about 4 KB; these caps keep it far below that.
  const message = JSON.stringify({
    title: payload.title.slice(0, 80),
    body: payload.body.slice(0, 240),
    url: payload.url?.startsWith("/") ? payload.url.slice(0, 100) : "/",
  });

  let sent = 0;
  let removed = 0;
  for (const sub of await listPushSubscriptions(userId)) {
    // Checked again here, not only when saved: a row can also be written through Supabase's own API under the owner
    // policy, and the server must never be made to post to a host that is not a known push service.
    if (!parseSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } })) {
      await deletePushSubscriptionById(userId, sub.id);
      removed++;
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, message, {
        vapidDetails: details,
        TTL,
        urgency: "normal",
        timeout: 10_000,
      });
      await recordPushSuccess(userId, sub.id);
      sent++;
    } catch (error) {
      const status = error instanceof webpush.WebPushError ? error.statusCode : undefined;
      if (status === 404 || status === 410) {
        await deletePushSubscriptionById(userId, sub.id);
        removed++;
      } else if (status !== undefined && (await recordPushFailure(userId, sub.id)) >= MAX_FAILURES) {
        await deletePushSubscriptionById(userId, sub.id);
        removed++;
      }
    }
  }
  return { configured: true, sent, removed };
}
