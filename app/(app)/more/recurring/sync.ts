import "server-only";
import { cache } from "react";
import { generateDueRecurring } from "@/db/queries";

/**
 * Creates the recurring rows that have come due (idempotent). A layout and its page render side by side, so every
 * page that reads ledger rows awaits this too; React's per-request cache makes the second call share the first.
 */
export const syncRecurring = cache((userId: string) => generateDueRecurring(userId));
