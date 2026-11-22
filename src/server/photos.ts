import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { profiles, tags } from "@/lib/db/schema";
import { PROFILE_TYPE_SCHEMAS } from "@/profile-types/modules";
import type { ProfileType } from "@/profile-types/registry";
import { STORAGE_KEY_PATTERN } from "@/profile-types/shared/fields";
import { ImageError, MAX_UPLOAD_BYTES, processImage } from "./images";
import { getOwnedProfile } from "./profiles";
import { hit } from "./rate-limit";
import type { Storage } from "./storage";

export type ImageSlot = "photoKey" | "logoKey";

/** Which images each profile type has. Lost wallet/ID has none: a photo could show card or ID numbers. */
export const IMAGE_SLOTS: Record<ProfileType, readonly ImageSlot[]> = {
  business_card: ["photoKey", "logoKey"],
  lost_pet: ["photoKey"],
  lost_device: ["photoKey"],
  lost_id: [],
};

const UPLOADS_PER_HOUR = 30;

export type UploadResult = { ok: true } | { ok: false; message: string };

const MESSAGES = {
  size: `Choose an image under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
  format: "Use a JPEG, PNG, WebP or HEIC photo.",
  unreadable: "That file isn't an image we can read.",
} as const;

/** URL the public page uses for a stored image. */
export function imageUrl(key: unknown): string | undefined {
  return typeof key === "string" && STORAGE_KEY_PATTERN.test(key) ? `/media/${key}` : undefined;
}

/**
 * Store a new photo or logo for the user's own profile: re-encoded (metadata, including GPS, removed),
 * saved under a fresh random key, then the profile points at it and the previous image is deleted.
 */
export async function uploadProfileImage(
  db: Database,
  storage: Storage,
  opts: { userId: string; tagId: string; slot: ImageSlot; file: Uint8Array },
): Promise<UploadResult> {
  const owned = await getOwnedProfile(db, opts.userId, opts.tagId);
  if (!owned) return { ok: false, message: "Profile not found." };
  const { profile } = owned;
  if (!IMAGE_SLOTS[profile.type].includes(opts.slot)) return { ok: false, message: "This profile has no such image." };
  if (!(await hit(db, `upload:user:${opts.userId}`, { limit: UPLOADS_PER_HOUR, windowSeconds: 3600 })).allowed) {
    return { ok: false, message: "Too many uploads. Please try again later." };
  }

  let webp: Uint8Array;
  try {
    webp = await processImage(opts.file, opts.slot === "logoKey" ? 512 : 1024);
  } catch (err) {
    if (err instanceof ImageError) return { ok: false, message: MESSAGES[err.message as keyof typeof MESSAGES] };
    throw err;
  }

  const kind = opts.slot === "logoKey" ? "logo" : "photo";
  const key = `p/${profile.id}/${kind}-${randomBytes(12).toString("hex")}.webp`;
  await storage.put(key, webp, "image/webp");

  const previous = (profile.data as Record<string, unknown> | null)?.[opts.slot];
  const next = { ...(profile.data as Record<string, unknown>), [opts.slot]: key };
  const checked = PROFILE_TYPE_SCHEMAS[profile.type].validate(next);
  if (!checked.success) {
    await storage.delete(key);
    return { ok: false, message: "Your profile has invalid details; save it first, then add the image." };
  }
  await db.update(profiles).set({ data: checked.data }).where(eq(profiles.id, profile.id));
  if (typeof previous === "string" && previous !== key) await storage.delete(previous).catch(() => undefined);
  return { ok: true };
}

/** Remove the user's photo or logo (from the profile and from storage). */
export async function removeProfileImage(
  db: Database,
  storage: Storage,
  opts: { userId: string; tagId: string; slot: ImageSlot },
): Promise<boolean> {
  const owned = await getOwnedProfile(db, opts.userId, opts.tagId);
  if (!owned || !IMAGE_SLOTS[owned.profile.type].includes(opts.slot)) return false;
  const data = { ...(owned.profile.data as Record<string, unknown>) };
  const previous = data[opts.slot];
  delete data[opts.slot];
  await db.update(profiles).set({ data }).where(eq(profiles.id, owned.profile.id));
  if (typeof previous === "string") await storage.delete(previous).catch(() => undefined);
  return true;
}

/**
 * An image for /media: only if a profile currently uses it and its tag is active, or the viewer owns it.
 * Replaced, removed or disabled images stop being served.
 */
export async function getServableImage(db: Database, storage: Storage, key: string, viewerId: string | null) {
  if (!STORAGE_KEY_PATTERN.test(key)) return null;
  const [row] = await db
    .select({ status: tags.status, ownerId: tags.ownerId })
    .from(profiles)
    .innerJoin(tags, eq(tags.id, profiles.tagId))
    .where(
      and(
        or(sql`${profiles.data}->>'photoKey' = ${key}`, sql`${profiles.data}->>'logoKey' = ${key}`),
        or(eq(tags.status, "active"), viewerId ? eq(tags.ownerId, viewerId) : sql`false`),
      ),
    )
    .limit(1);
  if (!row) return null;
  return storage.get(key);
}
