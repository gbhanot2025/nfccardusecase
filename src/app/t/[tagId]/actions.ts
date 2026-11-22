"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ClaimState } from "@/components/ClaimForm";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/require-user";
import { CLAIM_MESSAGES, parseClaimForm } from "@/server/claim-form";
import { clientIp } from "@/server/request";
import { claimTag, isTagId } from "@/server/tags";

export async function claimAction(tagId: string, _prev: ClaimState, formData: FormData): Promise<ClaimState> {
  if (!isTagId(tagId)) return { error: CLAIM_MESSAGES.not_claimable };
  const user = await requireUser(`/t/${tagId}`);
  const input = parseClaimForm(formData);
  if (!input) return { error: "Enter the claim code and choose what this tag is for." };

  const result = await claimTag(getDb(), {
    tagId,
    userId: user.id,
    ip: await clientIp(),
    limitByIp: env().AUTH_RATE_LIMIT === "on",
    input,
  });
  if (!result.ok) return { error: CLAIM_MESSAGES[result.error] };

  revalidatePath("/dashboard");
  redirect(`/dashboard?claimed=${tagId}`);
}
