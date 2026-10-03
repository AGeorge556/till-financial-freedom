"use client";

import type { ReactNode } from "react";
import { usePrivacy } from "./PrivacyProvider";

/** Quantities and unit prices: quantity x price is the value, so privacy mode hides them like amounts. */
export function HoldingPrivate({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { hidden } = usePrivacy();
  return hidden ? (
    <span role="img" aria-label="Hidden" className={className}>
      ••••
    </span>
  ) : (
    <span className={className}>{children}</span>
  );
}
