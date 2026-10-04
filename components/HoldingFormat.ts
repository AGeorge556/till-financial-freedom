// Display-only helpers for the holding screens. No formula here decides a financial result.
import { formatDay } from "./dates";

export const KIND_LABEL = { stock: "Stock", fund: "Fund", other: "Other", gold: "Gold", cloud: "Savings Cloud" } as const;

export const GOLD_FORM_LABEL = { bar: "bar", coin: "coin", jewelry: "jewelry" } as const;

/** "21K coin". */
export const goldName = (karat: number | null, form: keyof typeof GOLD_FORM_LABEL | null) =>
  `${karat ?? "?"}K ${form ? GOLD_FORM_LABEL[form] : "gold"}`;

/** "3 Oct 2026". */
export const dateText = (iso: string) => `${formatDay(iso)} ${iso.slice(0, 4)}`;

/** A NUMERIC(20,6) string for display: "12500.500000" -> "12,500.5". String work only, never a float. */
export function plain(value: string): string {
  const [whole, frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${trimmed ? `.${trimmed}` : ""}`;
}

/** A NUMERIC(20,6) string as a person would type it back into a field: "12.500000" -> "12.5". No commas, no float. */
export const typed = (value: string): string => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

const ago = (days: number | null, word: string) =>
  days === null || days === 0 ? `${word} today` : `${word} ${days} ${days === 1 ? "day" : "days"} ago`;

export function updatedText(source: "price" | "last-transaction" | "none", days: number | null, gold = false): string {
  if (source === "none") return gold ? "No gold price yet" : "No price yet";
  if (source === "last-transaction") {
    return gold
      ? "No gold price entered yet, valued at your last transaction price"
      : "No price update yet, valued at last transaction price";
  }
  return ago(days, "Last updated");
}

/** A cloud is stale by its latest confirmation, not by a price. */
export const confirmedText = (days: number | null) => (days === null ? "Never confirmed" : ago(days, "Last confirmed"));
