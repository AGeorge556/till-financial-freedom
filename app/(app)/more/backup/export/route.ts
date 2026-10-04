import type { NextRequest } from "next/server";
import { listAccounts, listCategories, listTransactions, loadBackupRows } from "@/db/queries";
import { requireUserId } from "@/lib/auth";
import { serializeBackup, transactionsToCsv } from "@/lib/backup";
import { cairoToday } from "@/lib/finance-core/time";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return new Response("format must be json or csv", { status: 400 });

  let body: string;
  let contentType: string;
  let filename: string;
  if (format === "csv") {
    // Children first, then what they point at (the same order as loadBackupRows).
    const transactions = await listTransactions(userId);
    const accounts = await listAccounts(userId, { includeArchived: true });
    const categories = await listCategories(userId, { includeArchived: true });
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    // The BOM makes Excel read the file as UTF-8, so Arabic names survive.
    body = `\uFEFF${transactionsToCsv(transactions, byId(accounts), byId(categories))}`;
    contentType = "text/csv; charset=utf-8";
    filename = `tff-transactions-${cairoToday()}.csv`;
  } else {
    // loadBackupRows has no return annotation, so serializeBackup's input type is what fails if a table is missing.
    body = JSON.stringify(serializeBackup(await loadBackupRows(userId)));
    contentType = "application/json; charset=utf-8";
    filename = `tff-backup-${cairoToday()}.json`;
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
