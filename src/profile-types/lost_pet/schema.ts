import "server-only";
import { z } from "zod";
import { parseProfileData, validateWith } from "../shared/fields";
import { phoneNumber } from "../shared/phone";
import { LOST_PET_PRIVATE_FIELDS, lostPetShape } from "./shape";

export * from "./shape";

/**
 * Server authority for lost pet data: the vet phone is validated per country (libphonenumber-js max
 * metadata) and stored as E.164. Client code imports `./shape.ts` instead.
 */
const shape = lostPetShape(phoneNumber);

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

/** What a public page may see: the parsed data without private fields (e.g. the microchip number). */
export type LostPetPublicData = Omit<LostPetData, (typeof LOST_PET_PRIVATE_FIELDS)[number]>;

export function toLostPetPublicData(data: LostPetData): LostPetPublicData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose: private
  const { microchipNumber, ...rest } = data;
  return rest;
}
