import "server-only";
import { and, eq, lt } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { tags } from "@/lib/db/schema";

/** SDMReadCtr is 24 bits on the tag. */
export const MAX_SDM_COUNTER = 0xffffff;

/**
 * Record a verified tap counter, atomically and only if it moves forward:
 *   UPDATE tags SET last_counter = $c WHERE id = $id AND last_counter < $c
 * Returns false when the tag doesn't exist or the counter is not newer (a replayed or
 * out-of-order URL): the caller must then treat the tap as unverified.
 * Two concurrent requests with the same counter can't both succeed: Postgres re-checks
 * the WHERE clause on the locked row, so the second one updates nothing.
 */
export async function acceptTapCounter(db: Database, tagId: string, counter: number): Promise<boolean> {
  if (!Number.isInteger(counter) || counter < 1 || counter > MAX_SDM_COUNTER) return false;
  const updated = await db
    .update(tags)
    .set({ lastCounter: counter })
    .where(and(eq(tags.id, tagId), lt(tags.lastCounter, counter)))
    .returning({ id: tags.id });
  return updated.length === 1;
}
