"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { type ImageSlot, removeProfileImage, uploadProfileImage } from "@/server/photos";
import { getStorage } from "@/server/storage";
import { isTagId } from "@/server/tags";

export type ImageState = { status: "idle" | "saved" | "error"; message?: string };

const slotSchema = z.enum(["photoKey", "logoKey"]);

export async function uploadImageAction(
  tagId: string,
  slot: ImageSlot,
  _prev: ImageState,
  form: FormData,
): Promise<ImageState> {
  if (!isTagId(tagId) || !slotSchema.safeParse(slot).success) return { status: "error", message: "Not found." };
  const user = await requireUser(`/dashboard/tags/${tagId}`);
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose an image first." };
  const result = await uploadProfileImage(getDb(), getStorage(), {
    userId: user.id,
    tagId,
    slot,
    file: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/dashboard/tags/${tagId}`);
  return { status: "saved", message: "Image updated." };
}

export async function removeImageAction(tagId: string, slot: ImageSlot): Promise<void> {
  if (!isTagId(tagId) || !slotSchema.safeParse(slot).success) return;
  const user = await requireUser(`/dashboard/tags/${tagId}`);
  await removeProfileImage(getDb(), getStorage(), { userId: user.id, tagId, slot });
  revalidatePath(`/dashboard/tags/${tagId}`);
}
