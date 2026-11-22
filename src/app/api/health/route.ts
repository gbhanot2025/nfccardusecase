import { sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { runMaintenance } from "@/server/maintenance";

/**
 * Liveness + database check for Docker and uptime monitors. Says nothing about the app's internals.
 * Also triggers hourly housekeeping after responding (see src/server/maintenance.ts).
 */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  after(async () => {
    try {
      await runMaintenance(getDb());
    } catch {
      console.error("Maintenance run failed");
    }
  });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
