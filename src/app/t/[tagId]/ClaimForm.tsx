"use client";

import { useActionState } from "react";
import { FormError } from "@/components/FormError";
import { PROFILE_TYPE_INFO, type ProfileType } from "@/profile-types/registry";
import { claimAction, type ClaimState } from "./actions";

export type MovableProfile = { tagId: string; publicCode: string; type: ProfileType };

export function ClaimForm({
  tagId,
  allowedTypes,
  movable,
}: {
  tagId: string;
  allowedTypes: ProfileType[];
  movable: MovableProfile[];
}) {
  const [state, formAction, pending] = useActionState<ClaimState, FormData>(claimAction.bind(null, tagId), {});
  const single = allowedTypes.length === 1 && movable.length === 0;

  return (
    <form action={formAction}>
      <FormError message={state.error ?? null} />
      <label>
        Claim code
        <input
          name="claimCode"
          required
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXXX-XXXXX"
        />
      </label>

      <fieldset>
        <legend>What is this tag for?</legend>
        {allowedTypes.map((type) => (
          <label className="check" key={type}>
            <input type="radio" name="profile" value={`new:${type}`} required defaultChecked={single} />
            <span>
              <strong>{PROFILE_TYPE_INFO[type].label}</strong>
              <br />
              <span className="muted">{PROFILE_TYPE_INFO[type].description}</span>
            </span>
          </label>
        ))}
        {movable.length > 0 && (
          <p className="muted">Or replace a lost tag (its profile moves here, the old tag stops working):</p>
        )}
        {movable.map((p) => (
          <label className="check" key={p.tagId}>
            <input type="radio" name="profile" value={`move:${p.tagId}`} required />
            <span>
              Move my {PROFILE_TYPE_INFO[p.type].label.toLowerCase()} from tag{" "}
              <span className="mono">{p.publicCode}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={pending}>
        {pending ? "Activating…" : "Activate tag"}
      </button>
    </form>
  );
}
