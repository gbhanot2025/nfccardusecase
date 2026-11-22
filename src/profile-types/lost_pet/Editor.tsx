"use client";

import { CheckboxField, EditorForm, TextField, useProfileEditor } from "../shared/editor";
import { PHONE_MAX_INPUT } from "../shared/phone-input";
import type { EditorProps } from "../shared/types";
import type { LostPetData } from "./schema";
import { LOST_PET_LIMITS, lostPetFromFormData, validateLostPetForm } from "./shape";

const PRIVACY_HINT = "Shown to whoever finds your pet. Don't add your own phone number or email.";

/** Owner's form for a lost_pet profile. Lost mode itself is toggled separately (milestone 4). */
export function LostPetEditor({ action, initialData }: EditorProps<LostPetData>) {
  const { errors, ...form } = useProfileEditor({
    action,
    fromFormData: lostPetFromFormData,
    validate: validateLostPetForm,
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
        maxLength={PHONE_MAX_INPUT}
        hint="Your vet's number, not yours, starting with + and the country code. Only shown in lost mode."
        error={errors.vetPhone}
      />
      <CheckboxField
        label="My pet is microchipped"
        name="microchipped"
        defaultChecked={initialData.microchipped}
        hint="The public page will say the pet is microchipped, so a vet or shelter knows to scan it."
        error={errors.microchipped}
      />
      <TextField
        label="Microchip number (private)"
        name="microchipNumber"
        defaultValue={initialData.microchipNumber}
        maxLength={LOST_PET_LIMITS.microchipNumberInput}
        hint="Only you can see this. It is never shown on the public page. 9, 10 or 15 digits."
        error={errors.microchipNumber}
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
