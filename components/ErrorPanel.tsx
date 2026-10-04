"use client";

import Link from "next/link";
import { useEffect } from "react";
import { card, primaryBtn, secondaryBtn } from "./ui";

/** What every error.tsx shows: plain words, no figures, and only the digest in the log (the message can hold query parameters). */
export function ErrorPanel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("Render error, digest:", error.digest ?? "none");
  }, [error]);

  return (
    <section role="alert" className={`mt-8 p-6 ${card}`}>
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-muted">Something went wrong loading this page. Your data has not been changed.</p>
      <div className="mt-6 grid gap-3 sm:flex">
        {/* retry() fetches the page again; reset() would redraw the same failed result. */}
        <button type="button" onClick={retry} className={`${primaryBtn} sm:w-auto`}>
          Try again
        </button>
        <Link href="/" className={`${secondaryBtn} inline-flex items-center justify-center`}>
          Home
        </Link>
      </div>
    </section>
  );
}
