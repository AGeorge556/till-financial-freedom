import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (Supabase pooler connection string, port 6543).");

// prepare: false because the Supabase transaction-mode pooler does not support prepared statements.
const client = postgres(url, { prepare: false });

export const db = drizzle(client, { schema });
