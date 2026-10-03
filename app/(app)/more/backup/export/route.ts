import type { NextRequest } from "next/server";
import {
  getPlanSettings,
  getSettings,
  listAccounts,
  listAllocationEvents,
  listCategories,
  listGoalAllocations,
  listGoals,
  listOverrides,
  listRules,
  listTransactions,
} from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { serializeBackup, transactionsToCsv } from "@/lib/backup";
import { cairoToday } from "@/lib/finance-core/time";

/** Goals, allocations, rules and overrides, read in the same children-first order. */
async function readPlanning(userId: string) {
  const goalAllocationEvents = await listAllocationEvents(userId);
  const goalAllocations = await listGoalAllocations(userId);
  const allocationRules = await listRules(userId);
  // Rules can be deleted (their overrides go with them); drop overrides of a rule created after the rules were read.
  const ruleIds = new Set(allocationRules.map((r) => r.id));
  const allocationOverrides = (await listOverrides(userId)).filter((o) => ruleIds.has(o.ruleId));
  const goals = await listGoals(userId, { includeArchived: true });
  return { goals, goalAllocations, goalAllocationEvents, allocationRules, allocationOverrides };
}

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return new Response("format must be json or csv", { status: 400 });

  // Children first, then what they point at: accounts, categories and goals are never hard-deleted, so
  // everything a row points at is still there by the time they are read, even if a write lands in between.
  const transactions = await listTransactions(userId);
  const planning = format === "json" ? await readPlanning(userId) : undefined;
  const accounts = await listAccounts(userId, { includeArchived: true });
  const categories = await listCategories(userId, { includeArchived: true });

  let body: string;
  let contentType: string;
  let filename: string;
  if (format === "csv") {
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    // The BOM makes Excel read the file as UTF-8, so Arabic names survive.
    body = `﻿${transactionsToCsv(transactions, byId(accounts), byId(categories))}`;
    contentType = "text/csv; charset=utf-8";
    filename = `till-transactions-${cairoToday()}.csv`;
  } else {
    const settings = { ...(await getSettings(userId)), ...(await getPlanSettings(userId)) };
    body = JSON.stringify(serializeBackup({ settings, accounts, categories, transactions, ...planning! }));
    contentType = "application/json; charset=utf-8";
    filename = `till-backup-${cairoToday()}.json`;
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
