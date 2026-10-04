import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Kept on globalThis so dev hot reloads reuse the pool instead of opening a new one per edit.
const shared = globalThis as typeof globalThis & { tillSql?: ReturnType<typeof postgres> };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (Supabase pooler connection string, port 6543).");
  // prepare: false because the Supabase transaction-mode pooler does not support prepared statements.
  // max 5: one pool per serverless instance, and the pooler fans in many instances; a page runs at most ~12 reads at once, the rest queue.
  shared.tillSql ??= postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });
  return drizzle(shared.tillSql, { schema });
}

let instance: ReturnType<typeof connect> | undefined;

// Connects on first use, not at import, so `next build` works without DATABASE_URL.
export const db = new Proxy({} as ReturnType<typeof connect>, {
  get(_target, prop) {
    instance ??= connect();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
