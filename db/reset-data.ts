import postgres from "postgres";

// Clears one person's financial records so real figures can be entered. Without --confirm it only counts.
// Kept on purpose: categories, settings, assumptions, push subscriptions and the sign-in account itself.
// Run:  npm run db:reset-data            (shows what would be deleted)
//       npm run db:reset-data -- --confirm   (deletes; cannot be undone - download a backup first)

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local; rely on the process environment
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required.");

// Children before the rows they point at, so no foreign key is violated.
const CLEARED = [
  "goal_allocation_events",
  "goal_allocations",
  "allocation_overrides",
  "allocation_rules",
  "goals",
  "price_updates",
  "corporate_actions",
  "rate_history",
  "cloud_confirmations",
  "gold_prices",
  "liability_updates",
  "transactions",
  "budgets",
  "recurring_templates",
  "holdings",
  "liabilities",
  "accounts",
];
const KEPT = ["categories", "user_settings", "financial_assumptions", "push_subscriptions"];

const confirmed = process.argv.includes("--confirm");
const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  const users = await sql<{ id: string }[]>`select id from auth.users`;
  const userId = process.env.RESET_USER_ID ?? (users.length === 1 ? users[0].id : undefined);
  if (!userId) throw new Error(`Found ${users.length} sign-in accounts; set RESET_USER_ID to choose one.`);

  // A table added later must be listed above as cleared or kept; refusing here beats silently leaving data behind.
  const owned = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id'`;
  const unlisted = owned.map((t) => t.table_name).filter((t) => !CLEARED.includes(t) && !KEPT.includes(t));
  if (unlisted.length > 0) throw new Error(`Tables not listed in db/reset-data.ts: ${unlisted.join(", ")}`);

  await sql.begin(async (tx) => {
    let total = 0;
    for (const table of CLEARED) {
      const rows = confirmed
        ? (await tx.unsafe(`delete from "${table}" where user_id = $1`, [userId])).count
        : (await tx.unsafe<{ n: number }[]>(`select count(*)::int n from "${table}" where user_id = $1`, [userId]))[0].n;
      total += rows;
      if (rows > 0) console.log(`${confirmed ? "deleted" : "would delete"} ${rows} from ${table}`);
    }
    console.log(`${confirmed ? "Deleted" : "Would delete"} ${total} rows in total. Kept: ${KEPT.join(", ")}.`);
    if (!confirmed) console.log("Nothing was changed. Add -- --confirm to delete.");
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
