"use server";

import { headers } from "next/headers";
import { deletePushSubscription, savePushSubscription } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { deviceName } from "@/lib/passkeys";
import { pushConfigured, sendToUser } from "@/lib/push";
import { parseSubscription } from "@/lib/pushInput";
import type { ActionState } from "./shared";

/** Stores this browser's push subscription (PushSubscription.toJSON()) for the signed-in user. */
export async function saveSubscription(subscription: unknown): Promise<ActionState> {
  const userId = await requireUserId();
  if (!pushConfigured()) return { error: "Notifications are not set up on the server." };
  const parsed = parseSubscription(subscription);
  if (!parsed) return { error: "This browser gave a notification address that cannot be used." };

  const label = deviceName((await headers()).get("user-agent") ?? "");
  if (!(await savePushSubscription(userId, { ...parsed, label }))) {
    return { error: "This device is already linked to another account." };
  }
  return {};
}

export async function removeSubscription(endpoint: string): Promise<ActionState> {
  const userId = await requireUserId();
  if (typeof endpoint !== "string" || endpoint.length > 2048) return { error: "Could not turn off notifications." };
  await deletePushSubscription(userId, endpoint);
  return {};
}

/** Sends a fixed, harmless message to the signed-in user's own devices; `sent` is how many it reached. */
export async function sendTestNotification(): Promise<{ error?: string; sent?: number }> {
  const userId = await requireUserId();
  const result = await sendToUser(userId, {
    title: "TFF: test",
    body: "Notifications work on this device. Reminders will look like this.",
    url: "/",
  });
  return result.configured ? { sent: result.sent } : { error: "Notifications are not set up on the server." };
}
