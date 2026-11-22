"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ClaimState } from "@/components/ClaimForm";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/require-user";
import { CLAIM_MESSAGES, parseClaimForm } from "@/server/claim-form";
import { normalizePublicCode } from "@/server/codes";
import { clientIp } from "@/server/request";
import { claimByPublicCode, findTagByPublicCode } from "@/server/tags";

/** Claim with the printed code + claim code, for phones without NFC. Same rules and limits as a tap. */
export async function claimByCodeAction(
  publicCode: string,
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const code = normalizePublicCode(publicCode);
  if (!code) return { error: CLAIM_MESSAGES.invalid_code };
  const user = await requireUser(`/activate/${code}`);
  const input = parseClaimForm(formData);
  if (!input) return { error: "Enter the claim code and choose what this tag is for." };

  const db = getDb();
  const result = await claimByPublicCode(db, {
    publicCode: code,
    userId: user.id,
    ip: await clientIp(),
    limitByIp: env().AUTH_RATE_LIMIT === "on",
    input,
  });
  if (!result.ok) return { error: CLAIM_MESSAGES[result.error] };

  const claimed = await findTagByPublicCode(db, code);
  revalidatePath("/dashboard");
  redirect(`/dashboard?claimed=${claimed?.tag.id ?? ""}`);
}
