import type { NextRequest } from "next/server";
import { getSettings, listAccounts, listCategories, listTransactions } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { serializeBackup, transactionsToCsv } from "@/lib/backup";
import { cairoToday } from "@/lib/finance-core/time";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return new Response("format must be json or csv", { status: 400 });

  // Transactions first, then accounts and categories: those are never hard-deleted, so everything a
  // transaction points at is still there by the time they are read, even if a write lands in between.
  const transactions = await listTransactions(userId);
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
    const settings = await getSettings(userId);
    body = JSON.stringify(serializeBackup({ settings, accounts, categories, transactions }));
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
