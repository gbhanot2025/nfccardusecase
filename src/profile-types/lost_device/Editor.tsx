"use client";

import { EditorForm, TextField, useProfileEditor } from "../shared/editor";
import type { EditorProps } from "../shared/types";
import { LOST_DEVICE_LIMITS, lostDeviceFromFormData, validateLostDeviceData, type LostDeviceData } from "./schema";

/** Owner's form for a lost_device profile. Lost mode itself is toggled separately (milestone 4). */
export function LostDeviceEditor({ action, initialData }: EditorProps<LostDeviceData>) {
  const { errors, ...form } = useProfileEditor({
    action,
    fromFormData: lostDeviceFromFormData,
    validate: validateLostDeviceData,
  });
  return (
    <EditorForm {...form}>
      <TextField
        label="Device nickname"
        name="nickname"
        defaultValue={initialData.nickname}
        maxLength={LOST_DEVICE_LIMITS.nickname}
        placeholder="e.g. Work laptop"
        error={errors.nickname}
      />
      <TextField
        label="Return message"
        name="returnMessage"
        kind="textarea"
        defaultValue={initialData.returnMessage}
        maxLength={LOST_DEVICE_LIMITS.returnMessage}
        hint="Shown to whoever finds it. Don't add your phone number, email or address: finders message you through the page."
        error={errors.returnMessage}
      />
      <TextField
        label="Reward (optional)"
        name="reward"
        defaultValue={initialData.reward}
        maxLength={LOST_DEVICE_LIMITS.reward}
        hint="Only shown in lost mode."
        error={errors.reward}
      />
    </EditorForm>
  );
}
