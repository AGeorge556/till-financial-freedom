"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

const PRIVACY_KEY = "till:privacy";

let hidden = false;
let loaded = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function getSnapshot() {
  if (!loaded) {
    loaded = true;
    try {
      hidden = localStorage.getItem(PRIVACY_KEY) === "on";
    } catch {}
  }
  return hidden;
}

function toggle() {
  hidden = !getSnapshot();
  try {
    localStorage.setItem(PRIVACY_KEY, hidden ? "on" : "off");
  } catch {}
  listeners.forEach((l) => l());
}

const PrivacyContext = createContext({ hidden: false, toggle });

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const isHidden = useSyncExternalStore(subscribe, getSnapshot, () => false);
  useEffect(() => document.documentElement.removeAttribute("data-privacy-boot"), []);
  return <PrivacyContext value={{ hidden: isHidden, toggle }}>{children}</PrivacyContext>;
}

export const usePrivacy = () => useContext(PrivacyContext);

export function PrivacyToggle() {
  const { hidden: isHidden, toggle: flip } = usePrivacy();
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={isHidden}
      aria-label="Hide amounts"
      className="grid size-11 place-items-center rounded-full text-muted hover:text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        {isHidden && <path d="M4 4l16 16" />}
      </svg>
    </button>
  );
}
