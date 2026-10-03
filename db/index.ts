import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (Supabase pooler connection string, port 6543).");
  // prepare: false because the Supabase transaction-mode pooler does not support prepared statements.
  return drizzle(postgres(url, { prepare: false }), { schema });
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
