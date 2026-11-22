import "server-only";
import { lt } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { messages, scanEvents } from "@/lib/db/schema";
import { hit, pruneExpired } from "./rate-limit";

/** How long finder messages (with any contact details and location) and scan history are kept. */
export const RETENTION_DAYS = 180;

/**
 * Housekeeping: drop expired rate-limit windows and personal data past the retention period.
 * Runs at most once an hour, triggered by the health check (which an uptime monitor calls every minute).
 */
export async function runMaintenance(db: Database, now = new Date()): Promise<boolean> {
  const due = await hit(db, "maintenance:run", { limit: 1, windowSeconds: 60 * 60 });
  if (!due.allowed) return false;
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await pruneExpired(db);
  await db.delete(messages).where(lt(messages.createdAt, cutoff));
  await db.delete(scanEvents).where(lt(scanEvents.createdAt, cutoff));
  return true;
}
