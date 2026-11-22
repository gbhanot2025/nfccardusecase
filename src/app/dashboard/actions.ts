"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { disableOwnTag, enableOwnTag, isTagId } from "@/server/tags";

/** Owner turns one of their tags off or back on. Ownership is checked in the query itself. */
export async function setTagEnabledAction(formData: FormData): Promise<void> {
  const user = await requireUser("/dashboard");
  const tagId = String(formData.get("tagId") ?? "");
  if (!isTagId(tagId)) return;
  if (formData.get("enable") === "1") await enableOwnTag(getDb(), user.id, tagId);
  else await disableOwnTag(getDb(), user.id, tagId);
  revalidatePath("/dashboard");
}
