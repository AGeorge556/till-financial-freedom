"use client";

import { useActionState } from "react";
import { sendCode, verifyCode, type LoginState } from "./actions";

const field =
  "mt-2 block w-full rounded-xl border border-border bg-surface px-4 py-3 text-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground";
const button =
  "mt-4 w-full rounded-xl bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-60";

export default function LoginPage() {
  const [sent, send, sending] = useActionState<LoginState, FormData>(sendCode, {});
  const [verified, verify, verifying] = useActionState<LoginState, FormData>(verifyCode, {});
  const email = sent.email;
  const error = verified.error ?? sent.error;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 pb-[env(safe-area-inset-bottom)]">
      <h1 className="text-3xl font-semibold tracking-tight">Till</h1>
      <p className="mt-1 text-muted">
        {email ? `Enter the code sent to ${email}.` : "Sign in with a code sent to your email."}
      </p>

      {email ? (
        <form action={verify} className="mt-8">
          <input type="hidden" name="email" value={email} />
          <label htmlFor="code" className="text-sm text-muted">
            Code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            className={`${field} tabular-nums tracking-widest`}
          />
          <button type="submit" disabled={verifying} className={button}>
            {verifying ? "Checking…" : "Sign in"}
          </button>
        </form>
      ) : (
        <form action={send} className="mt-8">
          <label htmlFor="email" className="text-sm text-muted">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className={field} />
          <button type="submit" disabled={sending} className={button}>
            {sending ? "Sending…" : "Send code"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 text-negative">
          {error}
        </p>
      )}
    </main>
  );
}
