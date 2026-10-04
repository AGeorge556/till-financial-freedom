import { Fragment, type ReactNode } from "react";
import { BackLink, card } from "./ui";
import { Wide } from "./Wide";

/** A calm placeholder block. It holds no figures, and stands still under prefers-reduced-motion. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-lg bg-border motion-safe:animate-pulse ${className}`} />;
}

/** Wraps a loading screen: marks it busy and gives screen readers the word "Loading". */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {children}
    </div>
  );
}

/** A card of `rows` text lines, the size of the cards the pages draw (p-5, lines like text-base). */
export function SkeletonCard({ rows, className = "" }: { rows: number; className?: string }) {
  return (
    <div className={`p-5 ${card} ${className}`}>
      <Skeleton className="h-5 w-32" />
      <div className="mt-4 grid gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={`h-4 ${i % 2 ? "w-3/4" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * The shape of an ordinary page: optional back link, the page title (real text when known, so the heading never
 * jumps), then one card per entry of `cards`, each with that many lines. `wide` matches the pages that use <Wide>.
 */
export function PageSkeleton({ title, back, cards, wide }: { title?: string; back?: boolean; cards: number[]; wide?: boolean }) {
  const Frame = wide ? Wide : Fragment;
  return (
    <Loading>
      <Frame>
        {back && <BackLink href="/more">More</BackLink>}
        {title ? <h1 className="text-3xl font-semibold tracking-tight">{title}</h1> : <Skeleton className="h-9 w-48" />}
        <div className="mt-6 grid gap-4">
          {cards.map((rows, i) => (
            <SkeletonCard key={i} rows={rows} />
          ))}
        </div>
      </Frame>
    </Loading>
  );
}
