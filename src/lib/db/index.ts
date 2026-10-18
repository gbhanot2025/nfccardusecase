import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

// Created on first use (not at import) so builds don't need runtime secrets; reused across hot reloads.
const globalForDb = globalThis as unknown as { pgPool?: Pool; db?: Database };

export function getDb(): Database {
  if (!globalForDb.db) {
    globalForDb.pgPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 });
    globalForDb.db = drizzle({ client: globalForDb.pgPool, schema });
  }
  return globalForDb.db;
}
