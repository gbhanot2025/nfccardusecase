import "server-only";
import { hash } from "@node-rs/argon2";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { auditLog, tagBatches, tags } from "@/lib/db/schema";
import { FORM_FACTORS, PROFILE_TYPES } from "@/profile-types/registry";
import { formatClaimCode, newBatchId, newClaimCode, newPublicCode, newTagId } from "./codes";

export const MAX_BATCH_SIZE = 500;

export const createBatchInput = z.object({
  label: z.string().trim().min(1, "Give the batch a name").max(100),
  formFactor: z.enum(FORM_FACTORS),
  allowedTypes: z
    .array(z.enum(PROFILE_TYPES))
    .min(1, "Pick at least one profile type")
    .transform((types) => PROFILE_TYPES.filter((t) => types.includes(t))),
  quantity: z.coerce.number().int().min(1).max(MAX_BATCH_SIZE, `At most ${MAX_BATCH_SIZE} tags per batch`),
});
export type CreateBatchInput = z.infer<typeof createBatchInput>;

/** A tag with its plaintext claim code. Exists only in memory, returned once to the admin who created it. */
export type IssuedTag = { tagId: string; publicCode: string; claimCode: string };

/**
 * Argon2 runs on libuv's small thread pool (~19 MiB each); hashing a whole batch at once would make every
 * claim and file operation wait behind it. A few at a time keeps the server responsive.
 */
async function hashAll(codes: string[], concurrency = 4): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < codes.length; i += concurrency) {
    out.push(...(await Promise.all(codes.slice(i, i + concurrency).map((c) => hash(c)))));
  }
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === "23505";
}

/**
 * Create a batch of unclaimed tags. Claim codes are hashed with Argon2id before they touch the
 * database; the plaintext codes are returned exactly once so they can be printed.
 */
export async function createBatch(db: Database, input: CreateBatchInput, adminId: string) {
  // IDs are random, so a clash is astronomically unlikely; if one happens, regenerate the batch.
  for (let attempt = 1; ; attempt++) {
    const batchId = newBatchId();
    const issued: IssuedTag[] = Array.from({ length: input.quantity }, () => ({
      tagId: newTagId(),
      publicCode: newPublicCode(),
      claimCode: newClaimCode(),
    }));
    const hashes = await hashAll(issued.map((t) => t.claimCode));

    try {
      await db.transaction(async (tx) => {
        await tx.insert(tagBatches).values({
          id: batchId,
          label: input.label,
          formFactor: input.formFactor,
          allowedTypes: input.allowedTypes,
          quantity: input.quantity,
          createdBy: adminId,
        });
        await tx.insert(tags).values(
          issued.map((t, i) => ({
            id: t.tagId,
            publicCode: t.publicCode,
            claimCodeHash: hashes[i],
            formFactor: input.formFactor,
            allowedTypes: input.allowedTypes,
            batchId,
          })),
        );
        await tx.insert(auditLog).values({
          actorUserId: adminId,
          action: "batch.created",
          targetType: "tag_batch",
          targetId: batchId,
          metadata: { quantity: input.quantity, formFactor: input.formFactor },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 3) continue;
      throw err;
    }

    return {
      batchId,
      label: input.label,
      tags: issued.map((t) => ({ ...t, claimCode: formatClaimCode(t.claimCode) })),
    };
  }
}

/**
 * Give every still-unclaimed tag in a batch a new claim code (the old ones stop working).
 * For when the printed codes were lost before shipping. Claimed or disabled tags are untouched.
 */
export async function reissueClaimCodes(db: Database, batchId: string, adminId: string) {
  const [batch] = await db.select().from(tagBatches).where(eq(tagBatches.id, batchId));
  if (!batch) return null;

  // Hash before taking any locks: Argon2 is slow, and claims on these tags shouldn't wait for it.
  const candidates = await db
    .select({ id: tags.id, publicCode: tags.publicCode })
    .from(tags)
    .where(and(eq(tags.batchId, batchId), eq(tags.status, "unclaimed")))
    .orderBy(asc(tags.createdAt), asc(tags.id));
  const prepared = candidates.map((t) => ({ tagId: t.id, publicCode: t.publicCode, claimCode: newClaimCode() }));
  const hashes = await hashAll(prepared.map((t) => t.claimCode));

  const issued: IssuedTag[] = [];
  await db.transaction(async (tx) => {
    for (const [i, t] of prepared.entries()) {
      // Re-checked here: a tag claimed meanwhile keeps its owner and isn't in the new sheet.
      const updated = await tx
        .update(tags)
        .set({ claimCodeHash: hashes[i] })
        .where(and(eq(tags.id, t.tagId), eq(tags.status, "unclaimed")))
        .returning({ id: tags.id });
      if (updated.length === 1) issued.push(t);
    }
    await tx.insert(auditLog).values({
      actorUserId: adminId,
      action: "batch.claim_codes_reissued",
      targetType: "tag_batch",
      targetId: batchId,
      metadata: { count: issued.length },
    });
  });

  return {
    batchId,
    label: batch.label,
    tags: issued.map((t) => ({ ...t, claimCode: formatClaimCode(t.claimCode) })),
  };
}

export async function listBatches(db: Database) {
  const rows = await db
    .select({
      id: tagBatches.id,
      label: tagBatches.label,
      formFactor: tagBatches.formFactor,
      allowedTypes: tagBatches.allowedTypes,
      quantity: tagBatches.quantity,
      createdAt: tagBatches.createdAt,
      claimed: sql<number>`count(${tags.id}) filter (where ${tags.claimedAt} is not null)`,
    })
    .from(tagBatches)
    .leftJoin(tags, eq(tags.batchId, tagBatches.id))
    .groupBy(tagBatches.id)
    .orderBy(desc(tagBatches.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, claimed: Number(r.claimed) }));
}

export async function getBatch(db: Database, batchId: string) {
  const [batch] = await db.select().from(tagBatches).where(eq(tagBatches.id, batchId));
  if (!batch) return null;
  const batchTags = await db
    .select({
      id: tags.id,
      publicCode: tags.publicCode,
      status: tags.status,
      disabledReason: tags.disabledReason,
      claimedAt: tags.claimedAt,
      uid: tags.uid,
      lastCounter: tags.lastCounter,
    })
    .from(tags)
    .where(eq(tags.batchId, batchId))
    .orderBy(asc(tags.createdAt), asc(tags.id));
  const [{ unclaimed }] = await db
    .select({ unclaimed: count() })
    .from(tags)
    .where(and(eq(tags.batchId, batchId), eq(tags.status, "unclaimed")));
  return { batch, tags: batchTags, unclaimed };
}
