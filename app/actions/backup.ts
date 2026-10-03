"use server";

import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts, categories, transactions, userSettings } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { insertOrder, parseBackup } from "@/lib/backup";

export type ImportState = {
  error?: string;
  imported?: { accounts: number; categories: number; transactions: number };
};

const MAX_BYTES = 5 * 1024 * 1024;
// 17 columns x 1,000 rows stays under Postgres's 65,535 bind-parameter limit.
const CHUNK = 1000;

class Refused extends Error {}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

const when = (s: string | null) => (s === null ? null : new Date(s));

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
      await tx
        .insert(userSettings)
        .values({ userId, monthStartDay: b.settings.monthStartDay })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: { monthStartDay: b.settings.monthStartDay, updatedAt: new Date() },
        });

      const [a] = await tx.select({ n: count() }).from(accounts).where(eq(accounts.userId, userId));
      const [c] = await tx.select({ n: count() }).from(categories).where(eq(categories.userId, userId));
      const [t] = await tx.select({ n: count() }).from(transactions).where(eq(transactions.userId, userId));
      if (a.n + c.n + t.n > 0) {
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
      // Replaced rows sort before the rows that replace them, so each replaces_id target exists when it is referenced.
      for (const part of chunks(insertOrder(b.transactions))) {
        await tx
          .insert(transactions)
          .values(part.map((r) => ({ ...r, userId, voidedAt: when(r.voidedAt), createdAt: new Date(r.createdAt) })));
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
    imported: { accounts: b.accounts.length, categories: b.categories.length, transactions: b.transactions.length },
  };
}
