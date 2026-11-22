"use client";

import { EditorForm, TextField, useProfileEditor } from "../shared/editor";
import type { EditorProps } from "../shared/types";
import { LOST_ID_LIMITS, lostIdFromFormData, validateLostIdData, type LostIdData } from "./schema";

/**
 * Owner's form for a lost_id profile. Deliberately only a message and a reward: we never store ID
 * numbers, card numbers or addresses. Lost mode itself is toggled separately (milestone 4).
 */
export function LostIdEditor({ action, initialData }: EditorProps<LostIdData>) {
  const { errors, ...form } = useProfileEditor({
    action,
    fromFormData: lostIdFromFormData,
    validate: validateLostIdData,
  });
  return (
    <EditorForm {...form}>
      <p className="alert" role="note">
        For your safety, never enter ID, card or account numbers, your name, phone, email or address here. Finders
        message you through the page without seeing your details.
      </p>
      <TextField
        label="Return message"
        name="returnMessage"
        kind="textarea"
        defaultValue={initialData.returnMessage}
        maxLength={LOST_ID_LIMITS.returnMessage}
        hint="For example: “Thanks for finding my wallet! Please send me a message below.”"
        error={errors.returnMessage}
      />
      <TextField
        label="Reward (optional)"
        name="reward"
        defaultValue={initialData.reward}
        maxLength={LOST_ID_LIMITS.reward}
        hint="Only shown in lost mode."
        error={errors.reward}
      />
    </EditorForm>
  );
}
