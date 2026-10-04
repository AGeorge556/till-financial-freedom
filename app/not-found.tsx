import Link from "next/link";
import { card, secondaryBtn } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-5 pt-[calc(2rem+env(safe-area-inset-top))]">
      <section className={`p-6 ${card}`}>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-muted">This page does not exist, or it is no longer there. Your data has not been changed.</p>
        <Link href="/" className={`mt-6 inline-flex items-center justify-center ${secondaryBtn}`}>
          Home
        </Link>
      </section>
    </main>
  );
}
