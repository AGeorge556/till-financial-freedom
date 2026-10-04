"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

// Outside the app shell (the login page), so it brings its own page padding.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto max-w-2xl px-5 pt-[env(safe-area-inset-top)]">
      <ErrorPanel error={error} retry={retry} />
    </main>
  );
}
