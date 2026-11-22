import { z } from "zod";
import { formString, optionalField, optionalStorageKey, singleLineText, validateWith } from "../shared/fields";
import { REWARD_MAX, lostMultiLineText, lostText } from "../shared/lost";
import { lightPhoneNumber } from "../shared/phone-input";

/**
 * Lost pet fields, limits and form mapping. Client-safe: the shape takes the phone field as a
 * parameter, so the editor validates with a light phone check while `./schema.ts` (server) plugs in
 * per-country validation.
 */

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
export function lostPetShape<P extends z.ZodType<string>>(phone: P) {
  return {
    petName: lostText(LOST_PET_LIMITS.petName),
    breed: lostText(LOST_PET_LIMITS.breed),
    medicalNotes: lostMultiLineText(LOST_PET_LIMITS.medicalNotes),
    vetName: singleLineText(LOST_PET_LIMITS.vetName),
    vetPhone: optionalField(phone),
    reward: lostText(LOST_PET_LIMITS.reward),
    photoKey: optionalStorageKey,
  };
}

/** Light schema for client-side checks in the editor; the server schema is the authority. */
export const lostPetFormSchema = z.strictObject(lostPetShape(lightPhoneNumber));

export function validateLostPetForm(raw: unknown) {
  return validateWith(lostPetFormSchema, raw);
}

/**
 * Maps the editor's form fields to the raw object the schema validates. Keeps only known keys.
 * Image keys are never read from the form (a client could point them at someone else's upload):
 * the upload action (milestone 4) sets them, and the save action keeps the stored value.
 */
export function lostPetFromFormData(form: FormData): Record<string, unknown> {
  return {
    petName: formString(form, "petName"),
    breed: formString(form, "breed"),
    medicalNotes: formString(form, "medicalNotes"),
    vetName: formString(form, "vetName"),
    vetPhone: formString(form, "vetPhone"),
    reward: formString(form, "reward"),
  };
}
