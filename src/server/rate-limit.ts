import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";

export type RateLimitRule = { limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Count one hit against `key` in a fixed window, stored in Postgres so it holds across restarts and
 * multiple app instances. A single atomic upsert: no race between reading and incrementing.
 */
export async function hit(db: Database, key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const result = await db.execute<{ count: number; retry_after: number }>(sql`
    INSERT INTO app_rate_limits (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${rule.windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN app_rate_limits.reset_at <= now() THEN 1 ELSE app_rate_limits.count + 1 END,
      reset_at = CASE WHEN app_rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE app_rate_limits.reset_at END
    RETURNING count, GREATEST(0, CEIL(EXTRACT(EPOCH FROM reset_at - now())))::int AS retry_after
  `);
  const row = result.rows[0];
  return { allowed: row.count <= rule.limit, retryAfterSeconds: row.retry_after };
}

/** True if `key` is already over its limit, without counting a new hit. */
export async function isLimited(db: Database, key: string, rule: RateLimitRule): Promise<boolean> {
  const result = await db.execute<{ count: number }>(
    sql`SELECT count FROM app_rate_limits WHERE key = ${key} AND reset_at > now()`,
  );
  return (result.rows[0]?.count ?? 0) >= rule.limit;
}

/** Delete expired windows. Cheap; called opportunistically. */
export async function pruneExpired(db: Database): Promise<void> {
  await db.execute(sql`DELETE FROM app_rate_limits WHERE reset_at <= now()`);
}
