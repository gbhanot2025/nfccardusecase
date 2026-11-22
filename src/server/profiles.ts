import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { auditLog, profiles, tags } from "@/lib/db/schema";
import { PROFILE_TYPE_SCHEMAS } from "@/profile-types/modules";
import { PROFILE_TYPE_INFO } from "@/profile-types/registry";
import type { EditorState } from "@/profile-types/shared/types";
import { isTagId } from "./tags";

/** Image keys are set by the upload flow (milestone 4), never from the editor form, so a save keeps them. */
const SERVER_MANAGED_KEYS = ["photoKey", "logoKey"] as const;

/** The user's own tag with its profile, or null (also for someone else's tag: no hint either way). */
export async function getOwnedProfile(db: Database, userId: string, tagId: string) {
  if (!isTagId(tagId)) return null;
  const [row] = await db
    .select({ tag: tags, profile: profiles })
    .from(tags)
    .innerJoin(profiles, eq(profiles.tagId, tags.id))
    .where(and(eq(tags.id, tagId), eq(tags.ownerId, userId)));
  return row ?? null;
}

/**
 * Save the editor form for the user's own profile. The type's schema is the authority: the form is mapped
 * with `fromFormData`, validated strictly, and only then written.
 */
export async function saveProfileData(db: Database, userId: string, tagId: string, form: FormData) {
  const owned = await getOwnedProfile(db, userId, tagId);
  if (!owned) return { status: "error", message: "Profile not found." } satisfies EditorState;
  const { profile } = owned;
  const mod = PROFILE_TYPE_SCHEMAS[profile.type];

  const raw = mod.fromFormData(form);
  const stored = (profile.data ?? {}) as Record<string, unknown>;
  for (const key of SERVER_MANAGED_KEYS) {
    if (typeof stored[key] === "string") raw[key] = stored[key];
  }
  // Entering a microchip number means the pet is microchipped.
  if (profile.type === "lost_pet" && typeof raw.microchipNumber === "string" && raw.microchipNumber.trim()) {
    raw.microchipped = true;
  }

  const result = mod.validate(raw);
  if (!result.success) {
    return {
      status: "error",
      message: result.formError ?? "Please fix the highlighted fields.",
      fieldErrors: result.fieldErrors,
    } satisfies EditorState;
  }
  await db.update(profiles).set({ data: result.data }).where(eq(profiles.id, profile.id));
  await db
    .insert(auditLog)
    .values({ actorUserId: userId, action: "profile.updated", targetType: "profile", targetId: profile.id });
  return { status: "saved", message: "Saved." } satisfies EditorState;
}

/** Turn lost mode on or off. Only lost-item profiles have it (also enforced by a database check). */
export async function setLostMode(db: Database, userId: string, tagId: string, on: boolean): Promise<boolean> {
  const owned = await getOwnedProfile(db, userId, tagId);
  if (!owned || !PROFILE_TYPE_INFO[owned.profile.type].lostItem) return false;
  await db.update(profiles).set({ lostMode: on }).where(eq(profiles.id, owned.profile.id));
  await db.insert(auditLog).values({
    actorUserId: userId,
    action: on ? "profile.lost_mode_on" : "profile.lost_mode_off",
    targetType: "profile",
    targetId: owned.profile.id,
  });
  return true;
}
