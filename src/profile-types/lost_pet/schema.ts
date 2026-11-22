import { z } from "zod";
import {
  formString,
  optionalPhoneNumber,
  optionalStorageKey,
  parseProfileData,
  singleLineText,
  validateWith,
} from "../shared/fields";
import { REWARD_MAX, lostMultiLineText, lostText } from "../shared/lost";

export const LOST_PET_LIMITS = {
  petName: 60,
  breed: 80,
  medicalNotes: 500,
  vetName: 100,
  reward: REWARD_MAX,
} as const;

/**
 * No owner name/email/phone/address fields by design: the finder contacts the owner through the relay.
 * `vetPhone` is the vet clinic's number (listed in the spec), not the owner's.
 */
const shape = {
  petName: lostText(LOST_PET_LIMITS.petName),
  breed: lostText(LOST_PET_LIMITS.breed),
  medicalNotes: lostMultiLineText(LOST_PET_LIMITS.medicalNotes),
  vetName: singleLineText(LOST_PET_LIMITS.vetName),
  vetPhone: optionalPhoneNumber,
  reward: lostText(LOST_PET_LIMITS.reward),
  photoKey: optionalStorageKey,
};

/** Write schema: unknown keys (e.g. `ownerPhone`) are rejected. `{}` is valid ("not set up yet"). */
export const lostPetSchema = z.strictObject(shape);
export type LostPetData = z.output<typeof lostPetSchema>;

/** Safe on read: never throws; unknown keys are dropped and invalid fields fall back to "not set". */
export function parseLostPetData(raw: unknown): LostPetData {
  return parseProfileData(shape, raw);
}

export function validateLostPetData(raw: unknown) {
  return validateWith(lostPetSchema, raw);
}

export function isLostPetEmpty(data: LostPetData): boolean {
  return !data.petName && !data.breed && !data.photoKey;
}

export function lostPetFromFormData(form: FormData): Record<string, unknown> {
  return {
    petName: formString(form, "petName"),
    breed: formString(form, "breed"),
    medicalNotes: formString(form, "medicalNotes"),
    vetName: formString(form, "vetName"),
    vetPhone: formString(form, "vetPhone"),
    reward: formString(form, "reward"),
    photoKey: formString(form, "photoKey"),
  };
}
