import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Integration tests run against TEST_DATABASE_URL (a separate, disposable database). */
export async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("TEST_DATABASE_URL not set: integration tests will be skipped.");
    return;
  }
  const pool = new Pool({ connectionString: url });
  await pool.query(
    "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
  );
  await migrate(drizzle({ client: pool }), { migrationsFolder: "db/migrations" });
  await pool.end();
}
