"use client";

import { formatEGP, type Piasters } from "@/lib/finance-core/money";
import { usePrivacy } from "./PrivacyProvider";

export function Amount({
  value,
  showPiasters,
  className = "",
}: {
  value: Piasters;
  showPiasters?: boolean;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  const cls = `tabular-nums ${className}`;
  return hidden ? (
    <span data-amount role="img" aria-label="Amount hidden" className={cls}>
      •••• EGP
    </span>
  ) : (
    <span data-amount className={cls}>
      {formatEGP(value, { showPiasters })}
    </span>
  );
}
