import "server-only";
import { verify } from "@node-rs/argon2";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { auditLog, profiles, tags } from "@/lib/db/schema";
import { PROFILE_TYPES, type ProfileType } from "@/profile-types/registry";
import { normalizeClaimCode, normalizePublicCode, TAG_ID_PATTERN } from "./codes";
import { hit, type RateLimitRule } from "./rate-limit";
import { ipRateKey } from "./request";

/**
 * Claim attempts are counted before the code is checked, so parallel guessing can't slip through.
 * The caller's own limits (user, IP) are checked first and the per-tag limit is per user, so someone
 * who has seen a printed code can't lock the tag for its real buyer. The all-users cap is a backstop.
 */
export const CLAIM_LIMITS = {
  perTagPerUser: { limit: 10, windowSeconds: 60 * 60 },
  perTagAllUsers: { limit: 50, windowSeconds: 60 * 60 },
  perUser: { limit: 20, windowSeconds: 60 * 60 },
  perIp: { limit: 30, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

/** The caller's own limits: user, then IP (IPv6 by /64). */
async function callerWithinLimits(db: Database, userId: string, ip: string | null, limitByIp: boolean) {
  if (!(await hit(db, `claim:user:${userId}`, CLAIM_LIMITS.perUser)).allowed) return false;
  if (limitByIp && !(await hit(db, `claim:ip:${ipRateKey(ip ?? "unknown")}`, CLAIM_LIMITS.perIp)).allowed) {
    return false;
  }
  return true;
}

export function isTagId(value: string): boolean {
  return TAG_ID_PATTERN.test(value);
}

export async function findTagById(db: Database, tagId: string) {
  if (!isTagId(tagId)) return null;
  const [row] = await db
    .select({ tag: tags, profile: profiles })
    .from(tags)
    .leftJoin(profiles, eq(profiles.tagId, tags.id))
    .where(eq(tags.id, tagId));
  return row ?? null;
}

export async function findTagByPublicCode(db: Database, code: string) {
  const publicCode = normalizePublicCode(code);
  if (!publicCode) return null;
  const [row] = await db
    .select({ tag: tags, profile: profiles })
    .from(tags)
    .leftJoin(profiles, eq(profiles.tagId, tags.id))
    .where(eq(tags.publicCode, publicCode));
  return row ?? null;
}

export const claimInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new"), claimCode: z.string().max(40), type: z.enum(PROFILE_TYPES) }),
  z.object({ mode: z.literal("move"), claimCode: z.string().max(40), fromTagId: z.string().regex(TAG_ID_PATTERN) }),
]);
export type ClaimInput = z.infer<typeof claimInput>;

export type ClaimResult =
  | { ok: true }
  | { ok: false; error: "invalid_code" | "rate_limited" | "not_claimable" | "type_not_allowed" | "move_not_allowed" };

class ClaimAbort extends Error {
  constructor(readonly reason: "not_claimable" | "move_not_allowed") {
    super(reason);
  }
}

/**
 * Link an unclaimed tag to a user, either with a new (empty) profile of a chosen type or by moving
 * the profile from one of the user's other tags (replacing a lost tag; the old tag is disabled).
 * Everything happens in one transaction, and only one claimant can ever win a tag.
 */
export async function claimTag(
  db: Database,
  opts: { tagId: string; userId: string; ip: string | null; limitByIp: boolean; input: ClaimInput },
): Promise<ClaimResult> {
  const { tagId, userId, input } = opts;
  if (!isTagId(tagId)) return { ok: false, error: "not_claimable" };

  if (!(await callerWithinLimits(db, userId, opts.ip, opts.limitByIp))) return { ok: false, error: "rate_limited" };
  if (!(await hit(db, `claim:tag:${tagId}:user:${userId}`, CLAIM_LIMITS.perTagPerUser)).allowed) {
    return { ok: false, error: "rate_limited" };
  }
  if (!(await hit(db, `claim:tag:${tagId}`, CLAIM_LIMITS.perTagAllUsers)).allowed) {
    return { ok: false, error: "rate_limited" };
  }

  const [tag] = await db.select().from(tags).where(eq(tags.id, tagId));
  if (!tag || tag.status !== "unclaimed") return { ok: false, error: "not_claimable" };

  const code = normalizeClaimCode(input.claimCode);
  if (!code || !(await verify(tag.claimCodeHash, code))) return { ok: false, error: "invalid_code" };

  if (input.mode === "new" && !tag.allowedTypes.includes(input.type)) return { ok: false, error: "type_not_allowed" };

  try {
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(tags)
        .set({ status: "active", ownerId: userId, claimedAt: new Date() })
        .where(and(eq(tags.id, tagId), eq(tags.status, "unclaimed")))
        .returning({ id: tags.id });
      if (claimed.length === 0) throw new ClaimAbort("not_claimable");

      if (input.mode === "new") {
        await tx.insert(profiles).values({ tagId, type: input.type, data: {} });
        await tx.insert(auditLog).values({
          actorUserId: userId,
          action: "tag.claimed",
          targetType: "tag",
          targetId: tagId,
          metadata: { profileType: input.type },
        });
        return;
      }

      // Replacement: the old tag must be the user's own, still have its profile, and the new tag
      // must allow that profile's type.
      const [old] = await tx
        .select({ tagId: tags.id, profileId: profiles.id, type: profiles.type })
        .from(tags)
        .innerJoin(profiles, eq(profiles.tagId, tags.id))
        .where(
          and(
            eq(tags.id, input.fromTagId),
            eq(tags.ownerId, userId),
            // A profile on a tag an admin disabled stays put: moving it would undo the admin's decision.
            or(eq(tags.status, "active"), and(eq(tags.status, "disabled"), ne(tags.disabledReason, "admin"))),
          ),
        )
        .for("update");
      if (!old || old.tagId === tagId || !tag.allowedTypes.includes(old.type)) {
        throw new ClaimAbort("move_not_allowed");
      }
      await tx.update(profiles).set({ tagId }).where(eq(profiles.id, old.profileId));
      await tx
        .update(tags)
        .set({
          status: "disabled",
          // Keep an existing reason (e.g. the owner turned it off as lost); otherwise it was replaced.
          disabledReason: sql`coalesce(${tags.disabledReason}, 'replaced'::tag_disabled_reason)`,
          disabledAt: sql`coalesce(${tags.disabledAt}, now())`,
        })
        .where(eq(tags.id, old.tagId));
      await tx.insert(auditLog).values({
        actorUserId: userId,
        action: "tag.replaced",
        targetType: "tag",
        targetId: tagId,
        metadata: { replacedTagId: old.tagId },
      });
    });
  } catch (err) {
    if (err instanceof ClaimAbort) return { ok: false, error: err.reason };
    throw err;
  }
  return { ok: true };
}

/**
 * Claim using the code printed under the QR code instead of an NFC tap (phones without NFC).
 * An unknown public code gives the same answer as a wrong claim code and still counts against the
 * user's and IP's attempt limits, so this page can't be used to probe codes faster than claiming.
 */
export async function claimByPublicCode(
  db: Database,
  opts: { publicCode: string; userId: string; ip: string | null; limitByIp: boolean; input: ClaimInput },
): Promise<ClaimResult> {
  const code = normalizePublicCode(opts.publicCode);
  const [tag] = code ? await db.select({ id: tags.id }).from(tags).where(eq(tags.publicCode, code)) : [];
  if (!tag) {
    if (!(await callerWithinLimits(db, opts.userId, opts.ip, opts.limitByIp))) {
      return { ok: false, error: "rate_limited" };
    }
    return { ok: false, error: "invalid_code" };
  }
  return claimTag(db, {
    tagId: tag.id,
    userId: opts.userId,
    ip: opts.ip,
    limitByIp: opts.limitByIp,
    input: opts.input,
  });
}

/** The user's tags, newest first, with the profile type if one is attached. */
export async function listOwnedTags(db: Database, userId: string) {
  return db
    .select({
      id: tags.id,
      publicCode: tags.publicCode,
      formFactor: tags.formFactor,
      allowedTypes: tags.allowedTypes,
      status: tags.status,
      disabledReason: tags.disabledReason,
      claimedAt: tags.claimedAt,
      profileType: profiles.type,
    })
    .from(tags)
    .leftJoin(profiles, eq(profiles.tagId, tags.id))
    .where(eq(tags.ownerId, userId))
    .orderBy(desc(tags.claimedAt));
}

/** Profiles the user could move onto a new tag that allows `allowedTypes`. */
export function movableProfiles(
  owned: Awaited<ReturnType<typeof listOwnedTags>>,
  allowedTypes: readonly ProfileType[],
): { tagId: string; publicCode: string; type: ProfileType }[] {
  return owned
    .filter((t) => t.profileType && allowedTypes.includes(t.profileType))
    .map((t) => ({ tagId: t.id, publicCode: t.publicCode, type: t.profileType! }));
}

/** Owner turns a tag off (e.g. lost it). Its profile stays and can be moved to a replacement. */
export async function disableOwnTag(db: Database, userId: string, tagId: string): Promise<boolean> {
  const rows = await db
    .update(tags)
    .set({ status: "disabled", disabledReason: "owner", disabledAt: new Date() })
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, userId), eq(tags.status, "active")))
    .returning({ id: tags.id });
  if (rows.length === 0) return false;
  await db.insert(auditLog).values({ actorUserId: userId, action: "tag.disabled", targetType: "tag", targetId: tagId });
  return true;
}

/** Owner turns their own tag back on. Not possible if an admin disabled it or it was replaced. */
export async function enableOwnTag(db: Database, userId: string, tagId: string): Promise<boolean> {
  const rows = await db
    .update(tags)
    .set({ status: "active", disabledReason: null, disabledAt: null })
    .where(
      and(
        eq(tags.id, tagId),
        eq(tags.ownerId, userId),
        eq(tags.status, "disabled"),
        eq(tags.disabledReason, "owner"),
        sql`exists (select 1 from ${profiles} where ${profiles.tagId} = ${tags.id})`,
      ),
    )
    .returning({ id: tags.id });
  if (rows.length === 0) return false;
  await db.insert(auditLog).values({ actorUserId: userId, action: "tag.enabled", targetType: "tag", targetId: tagId });
  return true;
}

/** Admin disables any unclaimed or active tag (lost in shipping, abuse). Owners can't undo this. */
export async function adminDisableTag(db: Database, adminId: string, tagId: string): Promise<boolean> {
  const rows = await db
    .update(tags)
    .set({ status: "disabled", disabledReason: "admin", disabledAt: new Date() })
    .where(and(eq(tags.id, tagId), inArray(tags.status, ["unclaimed", "active"])))
    .returning({ id: tags.id });
  if (rows.length === 0) return false;
  await db
    .insert(auditLog)
    .values({ actorUserId: adminId, action: "admin.tag_disabled", targetType: "tag", targetId: tagId });
  return true;
}

/** Admin re-enables a tag they disabled: back to active if it has an owner, otherwise unclaimed. */
export async function adminEnableTag(db: Database, adminId: string, tagId: string): Promise<boolean> {
  const rows = await db
    .update(tags)
    .set({
      status: sql`case when ${tags.ownerId} is null then 'unclaimed'::tag_status else 'active'::tag_status end`,
      disabledReason: null,
      disabledAt: null,
    })
    .where(and(eq(tags.id, tagId), eq(tags.status, "disabled"), eq(tags.disabledReason, "admin")))
    .returning({ id: tags.id });
  if (rows.length === 0) return false;
  await db
    .insert(auditLog)
    .values({ actorUserId: adminId, action: "admin.tag_enabled", targetType: "tag", targetId: tagId });
  return true;
}

/** Admin lookup by tag ID or public code. */
export async function adminFindTag(db: Database, query: string) {
  const q = query.trim();
  if (isTagId(q.toLowerCase())) return findTagById(db, q.toLowerCase());
  return findTagByPublicCode(db, q);
}
