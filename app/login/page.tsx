"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const field =
  "mt-2 block w-full rounded-xl border border-border bg-surface px-4 py-3 text-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 pb-[env(safe-area-inset-bottom)]">
      <h1 className="text-3xl font-semibold tracking-tight">Till</h1>
      <p className="mt-1 text-muted">Sign in to your account.</p>

      <form action={action} className="mt-8">
        <label htmlFor="email" className="text-sm text-muted">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={field} />

        <label htmlFor="password" className="mt-4 block text-sm text-muted">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={field}
        />

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-xl bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {state.error && (
        <p role="alert" className="mt-4 text-negative">
          {state.error}
        </p>
      )}
    </main>
  );
}
