"use server";

import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  accounts,
  allocationOverrides,
  allocationRules,
  categories,
  corporateActions,
  financialAssumptions,
  goalAllocationEvents,
  goalAllocations,
  goals,
  holdings,
  priceUpdates,
  transactions,
  userSettings,
} from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { insertOrder, parseBackup } from "@/lib/backup";

export type ImportState = {
  error?: string;
  imported?: { accounts: number; categories: number; transactions: number; goals: number; rules: number; holdings: number };
};

const MAX_BYTES = 5 * 1024 * 1024;
// 20 columns (the widest table) x 1,000 rows stays under Postgres's 65,535 bind-parameter limit.
const CHUNK = 1000;

class Refused extends Error {}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

const when = (s: string | null) => (s === null ? null : new Date(s));
// numeric(8,6) columns take text; toFixed(6) is exact for any rate with at most 6 decimals.
const rateText = (n: number | null) => (n === null ? null : n.toFixed(6));

/** Restores a backup file into an empty account, all or nothing. Never merges and never overwrites. */
export async function importBackup(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const userId = await requireUserId();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a backup file (.json) first." };
  if (file.size > MAX_BYTES) return { error: "That file is larger than 5 MB, so it is not a Till backup." };

  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { error: "That file is not valid JSON." };
  }
  const parsed = parseBackup(json);
  if (!parsed.ok) return { error: `Nothing was restored. ${parsed.error}` };
  const b = parsed.backup;

  try {
    await db.transaction(async (tx) => {
      // Upserting settings first takes this user's row lock, so a second restore running at the same time
      // waits here until this one commits, then finds data and refuses.
      const settings = { ...b.settings, savingsTargetPercent: rateText(b.settings.savingsTargetPercent) };
      await tx
        .insert(userSettings)
        .values({ userId, ...settings })
        .onConflictDoUpdate({ target: userSettings.userId, set: { ...settings, updatedAt: new Date() } });

      const [a] = await tx.select({ n: count() }).from(accounts).where(eq(accounts.userId, userId));
      const [c] = await tx.select({ n: count() }).from(categories).where(eq(categories.userId, userId));
      const [t] = await tx.select({ n: count() }).from(transactions).where(eq(transactions.userId, userId));
      const [g] = await tx.select({ n: count() }).from(goals).where(eq(goals.userId, userId));
      const [r] = await tx.select({ n: count() }).from(allocationRules).where(eq(allocationRules.userId, userId));
      if (a.n + c.n + t.n + g.n + r.n > 0) {
        throw new Refused(
          "Nothing was restored. A backup can only be restored into an empty account; this one already has data.",
        );
      }

      for (const part of chunks(b.accounts)) {
        await tx.insert(accounts).values(
          part.map((r) => ({
            ...r,
            userId,
            archivedAt: when(r.archivedAt),
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        );
      }
      for (const part of chunks(b.categories)) {
        await tx
          .insert(categories)
          .values(part.map((r) => ({ ...r, userId, archivedAt: when(r.archivedAt), createdAt: new Date(r.createdAt) })));
      }
      // Dependency order: holdings need accounts; transactions, price updates and corporate actions need holdings.
      for (const part of chunks(b.holdings)) {
        await tx.insert(holdings).values(
          part.map((r) => ({
            ...r,
            userId,
            archivedAt: when(r.archivedAt),
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        );
      }
      // Replaced rows sort before the rows that replace them, so each replaces_id target exists when it is referenced.
      for (const part of chunks(insertOrder(b.transactions))) {
        await tx
          .insert(transactions)
          .values(part.map((r) => ({ ...r, userId, voidedAt: when(r.voidedAt), createdAt: new Date(r.createdAt) })));
      }
      for (const part of chunks(b.priceUpdates)) {
        await tx.insert(priceUpdates).values(part.map((r) => ({ ...r, userId, createdAt: new Date(r.createdAt) })));
      }
      for (const part of chunks(b.corporateActions)) {
        await tx.insert(corporateActions).values(part.map((r) => ({ ...r, userId, createdAt: new Date(r.createdAt) })));
      }
      const assumptions = Object.fromEntries(Object.entries(b.assumptions).map(([k, v]) => [k, rateText(v)]));
      await tx
        .insert(financialAssumptions)
        .values({ userId, ...assumptions })
        .onConflictDoUpdate({ target: financialAssumptions.userId, set: { ...assumptions, updatedAt: new Date() } });
      // Dependency order: goals and rules before the rows that point at them.
      for (const part of chunks(b.goals)) {
        await tx.insert(goals).values(
          part.map((r) => ({
            ...r,
            userId,
            expectedReturnOverride: rateText(r.expectedReturnOverride),
            archivedAt: when(r.archivedAt),
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        );
      }
      for (const part of chunks(b.goalAllocations)) {
        await tx
          .insert(goalAllocations)
          .values(part.map((r) => ({ ...r, userId, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) })));
      }
      for (const part of chunks(b.goalAllocationEvents)) {
        await tx.insert(goalAllocationEvents).values(part.map((r) => ({ ...r, userId, createdAt: new Date(r.createdAt) })));
      }
      for (const part of chunks(b.allocationRules)) {
        await tx
          .insert(allocationRules)
          .values(part.map((r) => ({ ...r, userId, percent: rateText(r.percent), createdAt: new Date(r.createdAt) })));
      }
      for (const part of chunks(b.allocationOverrides)) {
        await tx.insert(allocationOverrides).values(part.map((r) => ({ ...r, userId, createdAt: new Date(r.createdAt) })));
      }
    });
  } catch (e) {
    if (e instanceof Refused) return { error: e.message };
    // Log the driver's message, not Drizzle's, which echoes the query parameters (financial data).
    const cause = ((e as { cause?: unknown })?.cause ?? e) as { code?: string; message?: string };
    console.error("importBackup failed", cause.code, cause.message);
    return {
      error: `The restore failed and nothing was written${cause.code ? ` (database error ${cause.code})` : ""}.`,
    };
  }

  revalidatePath("/", "layout");
  return {
    imported: {
      accounts: b.accounts.length,
      categories: b.categories.length,
      transactions: b.transactions.length,
      goals: b.goals.length,
      rules: b.allocationRules.length,
      holdings: b.holdings.length,
    },
  };
}
