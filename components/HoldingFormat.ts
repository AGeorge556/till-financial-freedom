// Display-only helpers for the holding screens. No formula here decides a financial result.
import { formatDay } from "./dates";

export const KIND_LABEL = { stock: "Stock", fund: "Fund", other: "Other" } as const;

/** "3 Oct 2026". */
export const dateText = (iso: string) => `${formatDay(iso)} ${iso.slice(0, 4)}`;

/** A NUMERIC(20,6) string for display: "12500.500000" -> "12,500.5". String work only, never a float. */
export function plain(value: string): string {
  const [whole, frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${trimmed ? `.${trimmed}` : ""}`;
}

export function updatedText(source: "price" | "last-transaction" | "none", days: number | null): string {
  if (source === "none") return "No price yet";
  if (source === "last-transaction") return "No price update yet, valued at last transaction price";
  return days === null || days === 0 ? "Last updated today" : `Last updated ${days} ${days === 1 ? "day" : "days"} ago`;
}
