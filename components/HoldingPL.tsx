"use client";

import { Amount } from "./Amount";
import { usePrivacy } from "./PrivacyProvider";

/** Profit or loss with a sign, a colour and a word, never colour alone. Privacy mode hides the sign and colour too. */
export function HoldingPL({
  value,
  showPiasters,
  className = "",
}: {
  value: number;
  showPiasters?: boolean;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  if (hidden) return <Amount value={value} className={className} />;
  const tone = value > 0 ? "text-positive" : value < 0 ? "text-negative" : "";
  const word = value > 0 ? "profit" : value < 0 ? "loss" : "no change";
  return (
    <span className={`${tone} ${className}`}>
      {value > 0 ? "+" : ""}
      <Amount value={value} showPiasters={showPiasters} /> <span className="text-xs font-normal">({word})</span>
    </span>
  );
}
