import type { ReactNode } from "react";

/**
 * Lets a page grow past the 42rem column from 1024px: up to 60rem, and never into the sidebar (15rem) plus a 1.5rem gutter.
 * A negative side margin does the widening, so nothing is transformed and sheets inside keep working.
 */
export function Wide({ children }: { children: ReactNode }) {
  return <div className="lg:mx-[calc((100%_-_min(100vw_-_18rem,_60rem))_/_2)]">{children}</div>;
}
