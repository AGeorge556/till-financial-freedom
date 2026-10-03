import type { accountType } from "@/db/schema";

export type AccountType = (typeof accountType.enumValues)[number];

// Record<AccountType, ...> makes tsc fail here if the database enum gains a value.
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: "Bank account",
  cash: "Cash",
  wallet: "Mobile wallet",
  brokerage: "Brokerage",
  savings: "Savings",
  credit_card: "Credit card",
  receivable: "Money owed to me",
  other: "Other",
};
