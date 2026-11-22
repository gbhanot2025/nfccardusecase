import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

/** Liveness + database check for Docker and uptime monitors. Says nothing about the app's internals. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
