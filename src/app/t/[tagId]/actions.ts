"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/require-user";
import { clientIp } from "@/server/request";
import { claimInput, claimTag, isTagId } from "@/server/tags";

export type ClaimState = { error?: string };

const MESSAGES = {
  invalid_code: "That claim code doesn't match this tag. Check the code on your packaging and try again.",
  rate_limited: "Too many attempts. For your security this tag is locked for a while; please try again later.",
  not_claimable: "This tag can't be activated. It may already be linked to an account.",
  type_not_allowed: "This tag can't be used for that kind of profile.",
  move_not_allowed: "That profile can't be moved to this tag.",
} as const;

export async function claimAction(tagId: string, _prev: ClaimState, formData: FormData): Promise<ClaimState> {
  if (!isTagId(tagId)) return { error: MESSAGES.not_claimable };
  const user = await requireUser(`/t/${tagId}`);

  // The profile choice is "new:<type>" or "move:<tagId of the profile to move>".
  const [mode, value] = String(formData.get("profile") ?? "").split(":", 2);
  const claimCode = formData.get("claimCode");
  const parsed = claimInput.safeParse(
    mode === "move" ? { mode, claimCode, fromTagId: value } : { mode: "new", claimCode, type: value },
  );
  if (!parsed.success) return { error: "Enter the claim code and choose what this tag is for." };

  const result = await claimTag(getDb(), {
    tagId,
    userId: user.id,
    ip: await clientIp(),
    limitByIp: env().AUTH_RATE_LIMIT === "on",
    input: parsed.data,
  });
  if (!result.ok) return { error: MESSAGES[result.error] };

  revalidatePath("/dashboard");
  redirect(`/dashboard?claimed=${tagId}`);
}
