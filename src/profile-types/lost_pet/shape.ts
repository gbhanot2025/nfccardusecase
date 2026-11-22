import { z } from "zod";
import { formString, optionalField, optionalStorageKey, validateWith } from "../shared/fields";
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
  microchipNumberInput: 24,
} as const;

/** ISO 11784 chips have 15 digits; older AVID/FECAVA chips 9 or 10. */
export const MICROCHIP_LENGTHS = [9, 10, 15] as const;
export const MICROCHIP_MESSAGE = "A microchip number has 9, 10 or 15 digits.";

/**
 * PRIVATE microchip number: only the owner sees it (in the editor). Spaces and dashes are accepted on
 * input and removed; digits only, exactly 9, 10 or 15 of them. Public pages only say the pet is
 * microchipped (a vet or shelter can read the chip themselves).
 */
export const microchipNumber = z
  .string()
  .trim()
  .max(LOST_PET_LIMITS.microchipNumberInput, MICROCHIP_MESSAGE)
  .refine((v) => /^[0-9 \-]+$/.test(v), MICROCHIP_MESSAGE)
  .transform((v) => v.replace(/[ \-]/g, ""))
  .refine((v) => (MICROCHIP_LENGTHS as readonly number[]).includes(v.length), MICROCHIP_MESSAGE);

/** Fields that must never reach a public page or any other public output. */
export const LOST_PET_PRIVATE_FIELDS = ["microchipNumber"] as const;

/**
 * No owner name/email/phone/address fields by design: the finder contacts the owner through the relay.
 * `vetPhone` is the vet clinic's number (listed in the spec), not the owner's.
 */
export function lostPetShape<P extends z.ZodType<string>>(phone: P) {
  return {
    petName: lostText(LOST_PET_LIMITS.petName),
    breed: lostText(LOST_PET_LIMITS.breed),
    medicalNotes: lostMultiLineText(LOST_PET_LIMITS.medicalNotes),
    vetName: lostText(LOST_PET_LIMITS.vetName),
    vetPhone: optionalField(phone),
    reward: lostText(LOST_PET_LIMITS.reward),
    microchipped: z.boolean().default(false),
    microchipNumber: optionalField(microchipNumber),
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
    microchipped: form.get("microchipped") === "on",
    microchipNumber: formString(form, "microchipNumber"),
  };
}
