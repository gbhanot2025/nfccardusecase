import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { messages, profiles, tags, user } from "@/lib/db/schema";
import { PROFILE_TYPE_INFO, type ProfileType } from "@/profile-types/registry";
import { verifySolution } from "./altcha";
import { normalizePublicCode } from "./codes";
import { hit, type RateLimitRule } from "./rate-limit";

export const RELAY_LIMITS = {
  perIp: { limit: 5, windowSeconds: 60 * 60 },
  perTag: { limit: 20, windowSeconds: 24 * 60 * 60 },
} satisfies Record<string, RateLimitRule>;

const optionalCoordinate = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().min(min).max(max).optional());

export const finderMessageInput = z
  .object({
    message: z.string().trim().min(1, "Write a short message for the owner.").max(2000),
    contact: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(200).optional(),
    ),
    latitude: optionalCoordinate(-90, 90),
    longitude: optionalCoordinate(-180, 180),
    altcha: z.string().max(1000),
  })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: "Location is incomplete.",
    path: ["latitude"],
  });

export type RelayResult =
  | {
      ok: true;
      email: {
        to: string;
        itemLabel: string;
        message: string;
        finderContact: string | null;
        location: { latitude: number; longitude: number } | null;
      };
      messageId: string;
    }
  | { ok: false; error: "invalid" | "not_found" | "bot_check" | "rate_limited"; message?: string };

const SHORT_LABEL: Record<ProfileType, string> = {
  business_card: "card",
  lost_pet: "pet",
  lost_device: "device",
  lost_id: "wallet or ID",
};

/**
 * A finder messages the owner of a lost-item tag. The owner's email is looked up here and only used to
 * deliver the email: it's never returned to the finder. Checks: input shape, bot check (ALTCHA, one use),
 * per-IP and per-tag limits. The caller sends the email and marks the message delivered.
 */
export async function submitFinderMessage(
  db: Database,
  opts: { publicCode: string; ip: string | null; raw: Record<string, unknown> },
): Promise<RelayResult> {
  const parsed = finderMessageInput.safeParse(opts.raw);
  if (!parsed.success) return { ok: false, error: "invalid", message: parsed.error.issues[0]?.message };
  const input = parsed.data;

  const code = normalizePublicCode(opts.publicCode);
  const [row] = code
    ? await db
        .select({
          tagId: tags.id,
          status: tags.status,
          profileId: profiles.id,
          type: profiles.type,
          ownerEmail: user.email,
        })
        .from(tags)
        .innerJoin(profiles, eq(profiles.tagId, tags.id))
        .innerJoin(user, eq(user.id, tags.ownerId))
        .where(eq(tags.publicCode, code))
    : [];
  if (!row || row.status !== "active" || !PROFILE_TYPE_INFO[row.type].lostItem)
    return { ok: false, error: "not_found" };

  if (!(await verifySolution(db, input.altcha))) return { ok: false, error: "bot_check" };

  const limits = [
    hit(db, `relay:tag:${row.tagId}`, RELAY_LIMITS.perTag),
    ...(opts.ip ? [hit(db, `relay:ip:${opts.ip}`, RELAY_LIMITS.perIp)] : []),
  ];
  if ((await Promise.all(limits)).some((r) => !r.allowed)) return { ok: false, error: "rate_limited" };

  const location =
    input.latitude !== undefined && input.longitude !== undefined
      ? { latitude: Number(input.latitude.toFixed(5)), longitude: Number(input.longitude.toFixed(5)) }
      : null;
  const [saved] = await db
    .insert(messages)
    .values({
      tagId: row.tagId,
      profileId: row.profileId,
      body: input.message,
      finderContact: input.contact ?? null,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
    })
    .returning({ id: messages.id });

  return {
    ok: true,
    messageId: saved.id,
    email: {
      to: row.ownerEmail,
      itemLabel: SHORT_LABEL[row.type],
      message: input.message,
      finderContact: input.contact ?? null,
      location,
    },
  };
}

export async function markDelivered(db: Database, messageId: string): Promise<void> {
  await db.update(messages).set({ deliveredAt: new Date() }).where(eq(messages.id, messageId));
}

/** Messages for the owner's profile (history follows the profile across replacement tags). */
export async function listMessagesForProfile(db: Database, profileId: string, limit = 50) {
  return db
    .select({
      id: messages.id,
      body: messages.body,
      finderContact: messages.finderContact,
      latitude: messages.latitude,
      longitude: messages.longitude,
      deliveredAt: messages.deliveredAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.profileId, profileId)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}
