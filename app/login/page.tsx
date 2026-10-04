"use client";

import { useActionState, useEffect } from "react";
import { signIn, type LoginState } from "./actions";

const field = "mt-2 block w-full rounded-xl border border-control bg-surface px-4 py-3 text-lg";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  // Reaching this page means the session is over, however it ended. Forget the auto-lock idle timestamp here so a
  // stale one can never lock the next sign-in at once (same key as components/AutoLock.tsx).
  useEffect(() => {
    try {
      localStorage.removeItem("till:lastActive");
    } catch {}
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 pb-[env(safe-area-inset-bottom)]">
      <h1 className="text-3xl font-semibold tracking-tight">Till</h1>
      <p className="mt-1 text-muted">Sign in to your account.</p>

      <form action={action} className="mt-8">
        <label htmlFor="email" className="text-sm text-muted">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "login-error" : undefined}
          className={field}
        />

        <label htmlFor="password" className="mt-4 block text-sm text-muted">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "login-error" : undefined}
          className={field}
        />

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-xl bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <span role="status" className="sr-only">
          {pending ? "Signing in, please wait." : ""}
        </span>
      </form>

      <p id="login-error" role="alert" className={state.error ? "mt-4 text-negative" : "sr-only"}>
        {state.error}
      </p>
    </main>
  );
}
