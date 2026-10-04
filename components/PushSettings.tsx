"use client";

import { useEffect, useState } from "react";
import { removeSubscription, saveSubscription, sendTestNotification } from "@/app/actions/push";
import { primaryBtn, secondaryBtn } from "./ui";

type State = "checking" | "install" | "unsupported" | "blocked" | "off" | "on";

const SAY: Record<State, string> = {
  checking: "Checking this device…",
  install: "On iPhone, notifications only work in the app added to your Home Screen. In Safari tap Share, then Add to Home Screen, open TFF from there, and come back to this page.",
  unsupported: "This browser cannot show notifications from TFF.",
  blocked: "Notifications are blocked for TFF. Allow them in your device settings (on iPhone: Settings, Notifications, TFF), then come back to this page.",
  off: "Notifications are off on this device.",
  on: "Notifications are on for this device.",
};

const asBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function detect(): Promise<State> {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (ios && !installed) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return (await currentSubscription()) && Notification.permission === "granted" ? "on" : "off";
}

/** Turn push notifications on or off for this device, and send a test. The permission prompt must come from a tap. */
export function PushSettings({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    detect().then(setState, () => setState("unsupported"));
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await task();
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  const turnOn = () =>
    run(async () => {
      // First await in the tap, so the browser still counts it as a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: asBytes(publicKey) }));
      const saved = await saveSubscription(sub.toJSON());
      if (saved.error) {
        await sub.unsubscribe();
        setError(saved.error);
        return;
      }
      setState("on");
      setStatus("Notifications are on. You will get one a day in the morning when something needs you.");
    });

  const turnOff = () =>
    run(async () => {
      const sub = await currentSubscription();
      if (sub) {
        const removed = await removeSubscription(sub.endpoint);
        if (removed.error) {
          setError(removed.error);
          return;
        }
        await sub.unsubscribe();
      }
      setState("off");
      setStatus("Notifications are off on this device.");
    });

  const test = () =>
    run(async () => {
      const result = await sendTestNotification();
      if (result.error) setError(result.error);
      else if (result.sent) setStatus("Sent. It should appear in a few seconds.");
      else setError("The test did not reach this device. Turn notifications off and on again, then retry.");
    });

  return (
    <div>
      <p className="text-sm text-muted">
        A notification only says what kind of reminder you have, like "a budget is near or over its limit", never an amount
        or a name. It arrives once a day in the morning, and only for the reminders switched on above.
      </p>
      <p className="mt-4 font-medium">{SAY[state]}</p>

      {state === "off" && (
        <button type="button" onClick={turnOn} disabled={busy} className={`mt-4 ${primaryBtn}`}>
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      )}
      {state === "on" && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={test} disabled={busy} className={secondaryBtn}>
            {busy ? "Working…" : "Send a test notification"}
          </button>
          <button type="button" onClick={turnOff} disabled={busy} className={secondaryBtn}>
            Turn off
          </button>
        </div>
      )}

      {/* Both regions stay mounted so a screen reader announces the text when it appears. */}
      <p role="status" className={status ? "mt-3 text-positive" : "sr-only"}>
        {status}
      </p>
      <p role="alert" className={error ? "mt-3 text-negative" : "sr-only"}>
        {error}
      </p>
    </div>
  );
}
