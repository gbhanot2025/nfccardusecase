import "server-only";
import { type ClaimInput, claimInput, type ClaimResult } from "./tags";

/** What the person sees for each claim failure. Deliberately vague: no hint whether a tag exists. */
export const CLAIM_MESSAGES: Record<Exclude<ClaimResult, { ok: true }>["error"], string> = {
  invalid_code: "That claim code doesn't match this tag. Check the codes on your packaging and try again.",
  rate_limited: "Too many attempts. For your security this is locked for a while; please try again later.",
  not_claimable: "This tag can't be activated. It may already be linked to an account.",
  type_not_allowed: "This tag can't be used for that kind of profile.",
  move_not_allowed: "That profile can't be moved to this tag.",
};

/** The profile choice is "new:<type>" or "move:<tagId of the profile to move>". */
export function parseClaimForm(formData: FormData): ClaimInput | null {
  const [mode, value] = String(formData.get("profile") ?? "").split(":", 2);
  const claimCode = formData.get("claimCode");
  const parsed = claimInput.safeParse(
    mode === "move" ? { mode, claimCode, fromTagId: value } : { mode: "new", claimCode, type: value },
  );
  return parsed.success ? parsed.data : null;
}
