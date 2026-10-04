"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { signOut } from "@/app/login/actions";

// localStorage (not sessionStorage) so a cold start of the home-screen app after a long time away still locks.
const ACTIVE_KEY = "till:lastActive";
// "input" covers dictation, paste and autofill, which fire no key events on iOS.
const EVENTS = ["pointerdown", "pointermove", "keydown", "input", "touchstart", "scroll", "wheel"] as const;
const WRITE_EVERY_MS = 1000;
const RETRY_MS = 5000;

function lastActive(): number | null {
  try {
    const t = Number(localStorage.getItem(ACTIVE_KEY));
    return t > 0 ? t : null;
  } catch {
    return null;
  }
}

function stamp(t = Date.now()) {
  try {
    localStorage.setItem(ACTIVE_KEY, String(t));
  } catch {}
}

/** Forget the timestamp, so the next sign-in starts a fresh idle period instead of locking at once. */
function clearStamp() {
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

/**
 * Signs out after `minutes` without a pointer, key, touch or scroll event, and straight away when the app is opened
 * again after being away longer than that. Time is compared with a stored timestamp, never counted by a timer, because
 * timers freeze while the phone app is in the background. `null` switches it off.
 */
export function AutoLock({ minutes }: { minutes: number | null }) {
  useEffect(() => {
    if (!minutes) {
      clearStamp(); // nothing refreshes it while off, so turning auto-lock on later must not find an old one
      return;
    }
    const limit = minutes * 60_000;
    let timer: number | undefined;
    let locking = false;
    let retrying = false;
    let disposed = false;
    let lastWrite = 0;

    function lock() {
      if (locking) return;
      locking = true;
      // Hide amounts at once (same switch the privacy boot script uses); the sign-out redirect then replaces the page.
      document.documentElement.setAttribute("data-privacy-boot", "");
      clearStamp();
      signOut().catch((e: unknown) => {
        // A successful sign-out ends in a redirect, which Next reports by rejecting this promise. Treating that as a
        // failure used to leave an expired timestamp behind and lock the next sign-in at once.
        if (String((e as { digest?: unknown })?.digest).startsWith("NEXT_REDIRECT")) return;
        if (disposed) return;
        // Offline or a server error: amounts stay hidden and the sign-out is tried again shortly. The timestamp stays
        // cleared and touch() is ignored meanwhile, so activity cannot cancel the pending lock.
        locking = false;
        retrying = true;
        timer = window.setTimeout(lock, RETRY_MS);
      });
    }

    function check() {
      if (locking || retrying) return;
      window.clearTimeout(timer);
      const idle = Date.now() - (lastActive() ?? Date.now());
      if (idle >= limit) lock();
      else timer = window.setTimeout(check, limit - idle);
    }

    function touch() {
      if (locking || retrying) return;
      const now = Date.now();
      if (now - lastWrite < WRITE_EVERY_MS) return;
      lastWrite = now;
      stamp(now);
    }

    function visibility() {
      if (document.visibilityState !== "visible") return;
      check();
      // Back within the limit: coming back counts as activity.
      if (!locking) touch();
    }

    if (lastActive() === null) stamp();
    check();
    EVENTS.forEach((e) => window.addEventListener(e, touch, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", visibility);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", visibility);
    };
  }, [minutes]);

  return null;
}

function SignOutSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl border border-border px-4 font-medium disabled:opacity-60">
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

/** The sign-out button: also forgets the idle timestamp so the next sign-in is not locked by an old one. */
export function SignOutButton() {
  return (
    <form action={signOut} onSubmit={clearStamp} className="mt-6">
      <SignOutSubmit />
    </form>
  );
}
