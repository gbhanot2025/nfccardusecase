"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import type { EditorState } from "@/profile-types/shared/types";
import { saveProfileData, setLostMode } from "@/server/profiles";
import { isTagId } from "@/server/tags";

export async function saveProfileAction(tagId: string, _prev: EditorState, form: FormData): Promise<EditorState> {
  if (!isTagId(tagId)) return { status: "error", message: "Profile not found." };
  const user = await requireUser(`/dashboard/tags/${tagId}`);
  const result = await saveProfileData(getDb(), user.id, tagId, form);
  if (result.status === "saved") revalidatePath(`/dashboard/tags/${tagId}`);
  return result;
}

export async function setLostModeAction(tagId: string, form: FormData): Promise<void> {
  if (!isTagId(tagId)) return;
  const user = await requireUser(`/dashboard/tags/${tagId}`);
  await setLostMode(getDb(), user.id, tagId, form.get("lostMode") === "on");
  revalidatePath(`/dashboard/tags/${tagId}`);
}
