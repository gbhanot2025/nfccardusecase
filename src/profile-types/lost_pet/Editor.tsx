"use client";

import { EditorForm, TextField, useProfileEditor } from "../shared/editor";
import type { EditorProps } from "../shared/types";
import { LOST_PET_LIMITS, lostPetFromFormData, validateLostPetData, type LostPetData } from "./schema";

const PRIVACY_HINT = "Shown to whoever finds your pet. Don't add your own phone number or email.";

/** Owner's form for a lost_pet profile. Lost mode itself is toggled separately (milestone 4). */
export function LostPetEditor({ action, initialData }: EditorProps<LostPetData>) {
  const { errors, ...form } = useProfileEditor({
    action,
    fromFormData: lostPetFromFormData,
    validate: validateLostPetData,
  });
  return (
    <EditorForm {...form}>
      <TextField
        label="Pet's name"
        name="petName"
        defaultValue={initialData.petName}
        maxLength={LOST_PET_LIMITS.petName}
        error={errors.petName}
      />
      <TextField
        label="Breed"
        name="breed"
        defaultValue={initialData.breed}
        maxLength={LOST_PET_LIMITS.breed}
        error={errors.breed}
      />
      <TextField
        label="Medical notes"
        name="medicalNotes"
        kind="textarea"
        defaultValue={initialData.medicalNotes}
        maxLength={LOST_PET_LIMITS.medicalNotes}
        hint={`Only shown in lost mode. ${PRIVACY_HINT}`}
        error={errors.medicalNotes}
      />
      <TextField
        label="Vet clinic"
        name="vetName"
        defaultValue={initialData.vetName}
        maxLength={LOST_PET_LIMITS.vetName}
        error={errors.vetName}
      />
      <TextField
        label="Vet phone"
        name="vetPhone"
        kind="tel"
        defaultValue={initialData.vetPhone}
        maxLength={32}
        hint="Your vet's number, not yours. Only shown in lost mode."
        error={errors.vetPhone}
      />
      <TextField
        label="Reward (optional)"
        name="reward"
        defaultValue={initialData.reward}
        maxLength={LOST_PET_LIMITS.reward}
        hint="Only shown in lost mode, e.g. “£50 reward”."
        error={errors.reward}
      />
    </EditorForm>
  );
}
