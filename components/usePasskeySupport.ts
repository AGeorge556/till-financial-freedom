import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True when this browser can do WebAuthn. False on the server and during hydration, so the markup always matches. */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(subscribe, () => typeof window.PublicKeyCredential === "function", () => false);
}
