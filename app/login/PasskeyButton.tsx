"use client";

import { useState } from "react";
import { usePasskeySupport } from "@/components/usePasskeySupport";
import { passkeyFailure, type PasskeyFailure } from "@/lib/passkeys";
import { createClient } from "@/lib/supabase/client";

/** "Sign in with Face ID or a passkey". Rendered only when the project has passkeys on; hidden when the browser cannot do WebAuthn. */
export function PasskeyButton() {
  const supported = usePasskeySupport();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<PasskeyFailure>({ kind: "silent" });

  if (!supported) return null;

  async function signIn() {
    setPending(true);
    setFailure({ kind: "silent" });
    try {
      const { data, error } = await createClient().auth.signInWithPasskey();
      if (!error && data?.session) {
        // The browser client has written the session cookies. A full navigation (not a client-side one) sends them to
        // proxy.ts and the server components. The target is fixed, never taken from the URL.
        window.location.assign("/");
        return;
      }
      setFailure(passkeyFailure(error ?? {}, "signIn"));
    } catch {
      setFailure(passkeyFailure({}, "signIn"));
    }
    setPending(false);
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="min-h-12 w-full rounded-xl bg-foreground px-4 font-semibold text-background disabled:opacity-60"
      >
        {pending ? "Waiting for Face ID…" : "Sign in with Face ID or a passkey"}
      </button>
      <p role="alert" className={failure.kind === "error" ? "mt-3 text-negative" : "sr-only"}>
        {failure.kind === "error" ? failure.text : ""}
      </p>
      <p role="status" className={failure.kind === "hint" ? "mt-3 text-sm text-muted" : "sr-only"}>
        {failure.kind === "hint" ? failure.text : ""}
      </p>
      <p className="mt-5 text-center text-sm text-muted">or use your password</p>
    </div>
  );
}
